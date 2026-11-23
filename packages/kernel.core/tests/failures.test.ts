import { describe, expect, it, vi } from "vitest";
import {
  type AspectActivator,
  activeFragmentsSlot,
  FragmentLifecycleError,
  failedFragmentsSlot,
  resolvedFragmentsSlot,
  waitingFragmentsSlot,
} from "../src/index.js";
import { archive, fragment, ids, membershipLog, newKernel } from "./helpers.js";

/** b requires a, c requires b, d stands alone; all enabled. */
async function setup(client: AspectActivator) {
  const onError = vi.fn();
  const { kernel, slots } = newKernel({ activators: { client }, onError });
  await kernel.install([
    archive(fragment("org.example.a")),
    archive(fragment("org.example.b", { requires: { "org.example.a": "^1.0.0" } })),
    archive(fragment("org.example.c", { requires: { "org.example.b": "^1.0.0" } })),
    archive(fragment("org.example.d")),
  ]);
  for (const id of ["org.example.a", "org.example.b", "org.example.c", "org.example.d"]) {
    await kernel.enable(id);
  }
  return { kernel, slots, onError };
}

/** An activator that throws for the ids in `broken`, which a test can empty to "fix" them. */
function breakable(...broken: string[]) {
  const set = new Set(broken);
  const activator: AspectActivator = (f) => {
    if (set.has(f.id)) throw new Error(`${f.id} is broken`);
  };
  return { activator, fix: (id: string) => set.delete(id) };
}

describe("failure isolation", () => {
  it("leaves a fragment whose activation throws failed with its error; its dependents wait, the others are active", async () => {
    const { activator } = breakable("org.example.b");
    const { kernel, slots } = await setup(activator);
    await kernel.activate("client");
    const failed = slots.getSnapshot(failedFragmentsSlot("client"));
    expect(ids(failed)).toEqual(["org.example.b"]);
    const failure = failed.get("org.example.b");
    expect(failure?.aspect).toBe("client");
    expect(failure?.fragment.id).toBe("org.example.b");
    expect(failure?.error).toEqual(new Error("org.example.b is broken"));
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client"))).sort()).toEqual([
      "org.example.a",
      "org.example.d",
    ]);
    // The dependent is neither active nor failed: it waits for b.
    expect(failed.has("org.example.c")).toBe(false);
    // Only the client aspect failed; nothing else changed state.
    expect(ids(slots.getSnapshot(failedFragmentsSlot("server")))).toEqual([]);
    expect(ids(slots.getSnapshot(resolvedFragmentsSlot))).toHaveLength(4);
  });

  it("retry activates the failed fragment once fixed, then the dependents that waited for it", async () => {
    const { activator, fix } = breakable("org.example.b");
    const { kernel, slots } = await setup(activator);
    await kernel.activate("client");
    const active = membershipLog(slots, activeFragmentsSlot("client"));
    const failed = membershipLog(slots, failedFragmentsSlot("client"));
    fix("org.example.b");
    await kernel.retry("client", "org.example.b");
    expect(active.events).toEqual(["+org.example.b", "+org.example.c"]);
    expect(failed.events).toEqual(["-org.example.b"]);
  });

  it("retry of a fragment still broken keeps it failed with the new error", async () => {
    const { activator } = breakable("org.example.b");
    const { kernel, slots, onError } = await setup(activator);
    await kernel.activate("client");
    const first = slots.get(failedFragmentsSlot("client"), "org.example.b");
    await kernel.retry("client", "org.example.b");
    const second = slots.get(failedFragmentsSlot("client"), "org.example.b");
    expect(second).toBeDefined();
    expect(second?.error).not.toBe(first?.error);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client"))).sort()).toEqual([
      "org.example.a",
      "org.example.d",
    ]);
  });

  it("retry refuses a fragment that has not failed in the aspect", async () => {
    const { kernel } = await setup(() => {});
    await kernel.activate("client");
    await expect(kernel.retry("client", "org.example.b")).rejects.toBeInstanceOf(
      FragmentLifecycleError,
    );
  });

  it("retry without an id retries every failed fragment of the aspect", async () => {
    const { activator, fix } = breakable("org.example.a", "org.example.d");
    const { kernel, slots } = await setup(activator);
    await kernel.activate("client");
    expect(ids(slots.getSnapshot(failedFragmentsSlot("client"))).sort()).toEqual([
      "org.example.a",
      "org.example.d",
    ]);
    fix("org.example.a");
    fix("org.example.d");
    await kernel.retry("client");
    expect(ids(slots.getSnapshot(failedFragmentsSlot("client")))).toEqual([]);
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client")))).toHaveLength(4);
  });

  it("retry activates only the dependents an activation was waiting to activate", async () => {
    const { activator, fix } = breakable("org.example.a");
    const { kernel, slots } = await setup(activator);
    // Only a was asked for: b and c were never meant to be active.
    await kernel.activate("client", "org.example.a");
    fix("org.example.a");
    await kernel.retry("client", "org.example.a");
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client")))).toEqual(["org.example.a"]);
  });

  it("a failed aspect returns to inactive when deactivated, disabled or the kernel stops", async () => {
    const { activator } = breakable("org.example.b", "org.example.d");
    const { kernel, slots } = await setup(activator);
    await kernel.activate("client");
    await kernel.deactivate("client", "org.example.d");
    expect(ids(slots.getSnapshot(failedFragmentsSlot("client")))).toEqual(["org.example.b"]);
    await kernel.disable("org.example.b", { cascade: true });
    expect(ids(slots.getSnapshot(failedFragmentsSlot("client")))).toEqual([]);
    await kernel.enable("org.example.b");
    await kernel.activate("client");
    expect(ids(slots.getSnapshot(failedFragmentsSlot("client"))).sort()).toEqual([
      "org.example.b",
      "org.example.d",
    ]);
    await kernel.stop();
    expect(ids(slots.getSnapshot(failedFragmentsSlot("client")))).toEqual([]);
  });
});

describe("fragments waiting for a failed requirement", () => {
  it("are published in the waiting slot with the requirements they wait for", async () => {
    const { activator } = breakable("org.example.b");
    const { kernel, slots } = await setup(activator);
    await kernel.activate("client");
    const waiting = slots.getSnapshot(waitingFragmentsSlot("client"));
    expect(ids(waiting)).toEqual(["org.example.c"]);
    const entry = waiting.get("org.example.c");
    expect(entry?.fragment.id).toBe("org.example.c");
    expect(entry?.aspect).toBe("client");
    expect(entry?.blockers).toEqual(["org.example.b"]);
    expect(ids(slots.getSnapshot(waitingFragmentsSlot("server")))).toEqual([]);
  });

  it("name a blocker reached through a fragment lacking the aspect", async () => {
    const { kernel, slots } = newKernel({
      activators: {
        client: (f) => {
          if (f.id === "org.example.c") throw new Error("boom");
        },
      },
      onError: () => {},
    });
    await kernel.install([
      archive(fragment("org.example.c")),
      archive(
        fragment("org.example.b", {
          aspects: { agent: {} },
          requires: { "org.example.c": "^1.0.0" },
        }),
      ),
      archive(fragment("org.example.a", { requires: { "org.example.b": "^1.0.0" } })),
    ]);
    for (const id of ["org.example.c", "org.example.b", "org.example.a"]) await kernel.enable(id);
    await kernel.activate("client");
    const waiting = slots.getSnapshot(waitingFragmentsSlot("client"));
    expect(ids(waiting)).toEqual(["org.example.a"]);
    expect(waiting.get("org.example.a")?.blockers).toEqual(["org.example.c"]);
  });

  it("leave the waiting slot once retry activates them", async () => {
    const { activator, fix } = breakable("org.example.b");
    const { kernel, slots } = await setup(activator);
    await kernel.activate("client");
    const waiting = membershipLog(slots, waitingFragmentsSlot("client"));
    fix("org.example.b");
    await kernel.retry("client", "org.example.b");
    expect(waiting.events).toEqual(["-org.example.c"]);
  });

  it("leave the waiting slot on a cascaded disable or removal, and on stop", async () => {
    for (const end of ["disable", "remove", "stop"] as const) {
      const { activator } = breakable("org.example.b");
      const { kernel, slots } = await setup(activator);
      await kernel.activate("client");
      expect(ids(slots.getSnapshot(waitingFragmentsSlot("client")))).toEqual(["org.example.c"]);
      if (end === "stop") await kernel.stop();
      else await kernel[end]("org.example.b", { cascade: true });
      expect(ids(slots.getSnapshot(waitingFragmentsSlot("client")))).toEqual([]);
    }
  });

  it("never hold a fragment the host did not ask to activate", async () => {
    const { activator } = breakable("org.example.a");
    const { kernel, slots } = await setup(activator);
    await kernel.activate("client", "org.example.a");
    expect(ids(slots.getSnapshot(failedFragmentsSlot("client")))).toEqual(["org.example.a"]);
    expect(ids(slots.getSnapshot(waitingFragmentsSlot("client")))).toEqual([]);
  });
});
