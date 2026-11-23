import { describe, expect, it } from "vitest";
import {
  activeFragmentsSlot,
  enabledFragmentsSlot,
  FragmentLifecycleError,
  installedFragmentsSlot,
  resolvedFragmentsSlot,
} from "../src/index.js";
import { archive, fragment, ids, membershipLog, newKernel } from "./helpers.js";

describe("fragment lifecycle as slot membership", () => {
  it("installs, enables, resolves and activates a fragment, each state visible in its slot", async () => {
    const { kernel, slots } = newKernel();
    const notes = archive({
      id: "org.example.notes",
      version: "1.0.0",
      engines: { platform: "^1.0.0" },
      aspects: { client: {} },
    });

    await kernel.install([notes]);
    expect(ids(slots.getSnapshot(installedFragmentsSlot))).toEqual(["org.example.notes"]);
    expect(ids(slots.getSnapshot(enabledFragmentsSlot))).toEqual([]);
    expect(slots.get(installedFragmentsSlot, "org.example.notes")?.manifest.version).toBe("1.0.0");

    await kernel.enable("org.example.notes");
    expect(ids(slots.getSnapshot(enabledFragmentsSlot))).toEqual(["org.example.notes"]);
    expect(ids(slots.getSnapshot(resolvedFragmentsSlot))).toEqual(["org.example.notes"]);
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client")))).toEqual([]);

    await kernel.activate("client", "org.example.notes");
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client")))).toEqual(["org.example.notes"]);
    expect(ids(slots.getSnapshot(activeFragmentsSlot("server")))).toEqual([]);
    // States accumulate: an active fragment is still installed, enabled and resolved.
    expect(ids(slots.getSnapshot(installedFragmentsSlot))).toEqual(["org.example.notes"]);
  });
});

/**
 * c requires b, b requires a; d stands alone. The archives are listed out of order so that
 * the install order says nothing about the dependency order.
 */
async function chain(options: Parameters<typeof newKernel>[0] = {}) {
  const { kernel, slots } = newKernel(options);
  await kernel.install([
    archive(fragment("org.example.c", { requires: { "org.example.b": "^1.0.0" } })),
    archive(fragment("org.example.d")),
    archive(fragment("org.example.b", { requires: { "org.example.a": "^1.0.0" } })),
    archive(fragment("org.example.a")),
  ]);
  return { kernel, slots };
}

describe("resolution", () => {
  it("resolves an enabled fragment only once every fragment it requires is resolved", async () => {
    const { kernel, slots } = await chain();
    await kernel.enable("org.example.c");
    await kernel.enable("org.example.b");
    expect(ids(slots.getSnapshot(enabledFragmentsSlot))).toEqual([
      "org.example.c",
      "org.example.b",
    ]);
    expect(ids(slots.getSnapshot(resolvedFragmentsSlot))).toEqual([]);

    const resolved = membershipLog(slots, resolvedFragmentsSlot);
    await kernel.enable("org.example.a");
    expect(resolved.events).toEqual(["+org.example.a", "+org.example.b", "+org.example.c"]);
  });

  it("refuses to enable a fragment that is not installed", async () => {
    const { kernel } = newKernel();
    await expect(kernel.enable("org.example.nope")).rejects.toBeInstanceOf(FragmentLifecycleError);
  });
});

describe("activation order", () => {
  it("activates an aspect of every resolved fragment in dependency order", async () => {
    const { kernel, slots } = await chain();
    for (const id of ["org.example.c", "org.example.d", "org.example.b", "org.example.a"]) {
      await kernel.enable(id);
    }
    const active = membershipLog(slots, activeFragmentsSlot("client"));
    await kernel.activate("client");
    expect(active.events.indexOf("+org.example.a")).toBeLessThan(
      active.events.indexOf("+org.example.b"),
    );
    expect(active.events.indexOf("+org.example.b")).toBeLessThan(
      active.events.indexOf("+org.example.c"),
    );
    expect(active.events.sort()).toEqual([
      "+org.example.a",
      "+org.example.b",
      "+org.example.c",
      "+org.example.d",
    ]);
  });

  it("activates the fragments one requires before it", async () => {
    const { kernel, slots } = await chain();
    for (const id of ["org.example.a", "org.example.b", "org.example.c", "org.example.d"]) {
      await kernel.enable(id);
    }
    const active = membershipLog(slots, activeFragmentsSlot("client"));
    await kernel.activate("client", "org.example.c");
    expect(active.events).toEqual(["+org.example.a", "+org.example.b", "+org.example.c"]);
  });

  it("does not activate an enabled fragment that is not resolved", async () => {
    const { kernel, slots } = await chain();
    await kernel.enable("org.example.c");
    await kernel.activate("client");
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client")))).toEqual([]);
  });

  it("activates only fragments that have the aspect", async () => {
    const { kernel, slots } = newKernel();
    await kernel.install([
      archive(fragment("org.example.agent-only", { aspects: { agent: {} } })),
      archive(fragment("org.example.ui")),
    ]);
    await kernel.enable("org.example.agent-only");
    await kernel.enable("org.example.ui");
    await kernel.activate("client");
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client")))).toEqual(["org.example.ui"]);
  });
});

describe("deactivation order", () => {
  async function allActive() {
    const setup = await chain();
    for (const id of ["org.example.a", "org.example.b", "org.example.c", "org.example.d"]) {
      await setup.kernel.enable(id);
    }
    await setup.kernel.activate("client");
    return setup;
  }

  it("stops every active aspect in reverse dependency order", async () => {
    const { kernel, slots } = await allActive();
    const active = membershipLog(slots, activeFragmentsSlot("client"));
    await kernel.stop();
    expect(active.events.indexOf("-org.example.c")).toBeLessThan(
      active.events.indexOf("-org.example.b"),
    );
    expect(active.events.indexOf("-org.example.b")).toBeLessThan(
      active.events.indexOf("-org.example.a"),
    );
    expect(active.events).toHaveLength(4);
    // Stopping deactivates; the fragments stay installed, enabled and resolved.
    expect(ids(slots.getSnapshot(resolvedFragmentsSlot))).toHaveLength(4);
  });

  it("deactivates the fragments that require one before it", async () => {
    const { kernel, slots } = await allActive();
    const active = membershipLog(slots, activeFragmentsSlot("client"));
    await kernel.deactivate("client", "org.example.a");
    expect(active.events).toEqual(["-org.example.c", "-org.example.b", "-org.example.a"]);
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client")))).toEqual(["org.example.d"]);
  });

  it("refuses to disable a fragment others require unless the cascade is confirmed", async () => {
    const { kernel, slots } = await allActive();
    const error = await kernel.disable("org.example.a").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FragmentLifecycleError);
    expect((error as Error).message).toContain("org.example.b");
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client")))).toHaveLength(4);
    expect(ids(slots.getSnapshot(enabledFragmentsSlot))).toHaveLength(4);
  });

  it("disables with a confirmed cascade: dependents deactivate first and become unresolved", async () => {
    const { kernel, slots } = await allActive();
    const active = membershipLog(slots, activeFragmentsSlot("client"));
    const resolved = membershipLog(slots, resolvedFragmentsSlot);
    await kernel.disable("org.example.a", { cascade: true });
    expect(active.events).toEqual(["-org.example.c", "-org.example.b", "-org.example.a"]);
    expect(resolved.events).toEqual(["-org.example.c", "-org.example.b", "-org.example.a"]);
    // Only a is disabled; b and c stay enabled, unresolved until a comes back.
    expect(ids(slots.getSnapshot(enabledFragmentsSlot)).sort()).toEqual([
      "org.example.b",
      "org.example.c",
      "org.example.d",
    ]);
    await kernel.enable("org.example.a");
    expect(ids(slots.getSnapshot(resolvedFragmentsSlot))).toHaveLength(4);
  });
});
