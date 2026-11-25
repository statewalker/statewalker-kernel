import { describe, expect, it, vi } from "vitest";
import {
  activeFragmentsSlot,
  enabledFragmentsSlot,
  FragmentCascadeError,
  FragmentLifecycleError,
  installedFragmentsSlot,
  type KernelOptions,
  resolvedFragmentsSlot,
} from "../src/index.js";
import { archive, fragment, ids, membershipLog, newKernel } from "./helpers.js";

/** b requires a, d stands alone; all enabled and active in the client aspect. */
async function setup(options: Partial<KernelOptions> = {}) {
  const log: string[] = [];
  const { kernel, slots } = newKernel({
    activators: {
      client: (f) => () => {
        log.push(`cleanup ${f.id}`);
      },
    },
    ...options,
  });
  await kernel.install([
    archive(fragment("org.example.a")),
    archive(fragment("org.example.b", { requires: { "org.example.a": "^1.0.0" } })),
    archive(fragment("org.example.d")),
  ]);
  for (const id of ["org.example.a", "org.example.b", "org.example.d"]) await kernel.enable(id);
  await kernel.activate("client");
  return { kernel, slots, log };
}

describe("removal", () => {
  it("deactivates the fragment and takes it out of every state, keeping its data", async () => {
    const removeData = vi.fn();
    const { kernel, slots, log } = await setup({ removeData });
    await kernel.remove("org.example.d");
    expect(log).toEqual(["cleanup org.example.d"]);
    for (const slot of [
      installedFragmentsSlot,
      enabledFragmentsSlot,
      resolvedFragmentsSlot,
      activeFragmentsSlot("client"),
    ]) {
      expect(slots.getSnapshot(slot).has("org.example.d")).toBe(false);
    }
    expect(removeData).not.toHaveBeenCalled();
    // Nothing else changed.
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client")))).toEqual([
      "org.example.a",
      "org.example.b",
    ]);
    // A removed fragment can be installed again (its data, kept by the host, still there).
    await kernel.install([archive(fragment("org.example.d"))]);
    expect(slots.getSnapshot(installedFragmentsSlot).has("org.example.d")).toBe(true);
  });

  it("removes the data only when 'remove with data' is confirmed, through the host's hook, once the fragment is gone", async () => {
    const seen: string[] = [];
    const { kernel, slots, log } = await setup({
      removeData: (f) => {
        seen.push(f.id);
        // Its code no longer runs, and it is no longer installed.
        expect(log).toEqual(["cleanup org.example.d"]);
        expect(slots.getSnapshot(installedFragmentsSlot).has("org.example.d")).toBe(false);
      },
    });
    await kernel.remove("org.example.d", { withData: true });
    expect(seen).toEqual(["org.example.d"]);
  });

  it("of a fragment others require changes nothing without confirmation and reports the dependents", async () => {
    const removeData = vi.fn();
    const { kernel, slots, log } = await setup({ removeData });
    const installed = membershipLog(slots, installedFragmentsSlot);
    const active = membershipLog(slots, activeFragmentsSlot("client"));
    const error = await kernel.remove("org.example.a", { withData: true }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FragmentCascadeError);
    expect((error as FragmentCascadeError).dependents).toEqual(["org.example.b"]);
    expect(installed.events).toEqual([]);
    expect(active.events).toEqual([]);
    expect(log).toEqual([]);
    expect(removeData).not.toHaveBeenCalled();
  });

  it("with a confirmed cascade deactivates the dependents, which stay installed and enabled, unresolved", async () => {
    const { kernel, slots } = await setup();
    const active = membershipLog(slots, activeFragmentsSlot("client"));
    await kernel.remove("org.example.a", { cascade: true });
    expect(active.events).toEqual(["-org.example.b", "-org.example.a"]);
    expect(ids(slots.getSnapshot(installedFragmentsSlot))).toEqual([
      "org.example.b",
      "org.example.d",
    ]);
    expect(ids(slots.getSnapshot(enabledFragmentsSlot))).toEqual([
      "org.example.b",
      "org.example.d",
    ]);
    expect(ids(slots.getSnapshot(resolvedFragmentsSlot))).toEqual(["org.example.d"]);
  });

  it("refuses 'remove with data' on a host that removes no data, changing nothing", async () => {
    const { kernel, slots, log } = await setup();
    await expect(kernel.remove("org.example.d", { withData: true })).rejects.toBeInstanceOf(
      FragmentLifecycleError,
    );
    expect(log).toEqual([]);
    expect(slots.getSnapshot(installedFragmentsSlot).has("org.example.d")).toBe(true);
    expect(slots.getSnapshot(activeFragmentsSlot("client")).has("org.example.d")).toBe(true);
  });

  it("refuses a fragment that is not installed, and a core fragment", async () => {
    const { kernel, slots } = newKernel({
      core: [archive(fragment("system.commands"))],
    });
    await kernel.start();
    await expect(kernel.remove("org.example.nope")).rejects.toBeInstanceOf(FragmentLifecycleError);
    await expect(kernel.remove("system.commands")).rejects.toBeInstanceOf(FragmentLifecycleError);
    expect(ids(slots.getSnapshot(installedFragmentsSlot))).toEqual(["system.commands"]);
    expect(ids(slots.getSnapshot(enabledFragmentsSlot))).toEqual(["system.commands"]);
  });

  it("refuses disabling a core fragment, except system.agents", async () => {
    const { kernel, slots } = newKernel({
      core: [archive(fragment("system.tasks")), archive(fragment("system.agents"))],
    });
    await kernel.start();
    const refused = await kernel.disable("system.tasks").catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(FragmentLifecycleError);
    expect(String((refused as Error).message)).toMatch(/system\.tasks.*cannot be disabled/);
    expect(ids(slots.getSnapshot(enabledFragmentsSlot)).sort()).toEqual([
      "system.agents",
      "system.tasks",
    ]);
    // Only system.agents may be: the platform runs without AI (ADR 2026-11-20-kernel-and-core-fragments).
    await kernel.disable("system.agents");
    expect(ids(slots.getSnapshot(enabledFragmentsSlot))).toEqual(["system.tasks"]);
  });

  it("reports a failing data removal to the caller; the fragment is removed all the same", async () => {
    const boom = new Error("storage unavailable");
    const { kernel, slots } = await setup({
      removeData: () => {
        throw boom;
      },
    });
    await expect(kernel.remove("org.example.d", { withData: true })).rejects.toBe(boom);
    expect(slots.getSnapshot(installedFragmentsSlot).has("org.example.d")).toBe(false);
  });
});

describe("baseline fragments", () => {
  it("refuses to remove a baseline fragment, changing nothing", async () => {
    const { kernel, slots, log } = await setup({ baseline: ["org.example.d"] });
    await expect(kernel.remove("org.example.d")).rejects.toThrow(FragmentLifecycleError);
    await expect(kernel.remove("org.example.d", { cascade: true })).rejects.toThrow(/baseline/);
    expect(log).toEqual([]);
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client")))).toEqual([
      "org.example.a",
      "org.example.b",
      "org.example.d",
    ]);
  });

  it("disables and enables a baseline fragment", async () => {
    const { kernel, slots, log } = await setup({ baseline: ["org.example.d"] });
    await kernel.disable("org.example.d");
    expect(log).toEqual(["cleanup org.example.d"]);
    expect(slots.getSnapshot(enabledFragmentsSlot).has("org.example.d")).toBe(false);
    expect(slots.getSnapshot(installedFragmentsSlot).has("org.example.d")).toBe(true);
    await kernel.enable("org.example.d");
    expect(slots.getSnapshot(resolvedFragmentsSlot).has("org.example.d")).toBe(true);
  });

  it("still removes the fragments outside the baseline", async () => {
    const { kernel, slots } = await setup({ baseline: ["org.example.d"] });
    await kernel.remove("org.example.b");
    expect(slots.getSnapshot(installedFragmentsSlot).has("org.example.b")).toBe(false);
  });
});
