import { describe, expect, it } from "vitest";
import {
  activeFragmentsSlot,
  enabledFragmentsSlot,
  FragmentCascadeError,
  FragmentLifecycleError,
  installedFragmentsSlot,
  resolvedFragmentsSlot,
} from "../src/index.js";
import { archive, fragment, ids, membershipLog, newKernel } from "./helpers.js";

/** b requires a, c requires b, d stands alone; all enabled and active in the client aspect. */
async function allActive() {
  const { kernel, slots } = newKernel();
  await kernel.install([
    archive(fragment("org.example.a")),
    archive(fragment("org.example.b", { requires: { "org.example.a": "^1.0.0" } })),
    archive(fragment("org.example.c", { requires: { "org.example.b": "^1.0.0" } })),
    archive(fragment("org.example.d")),
  ]);
  for (const id of ["org.example.a", "org.example.b", "org.example.c", "org.example.d"]) {
    await kernel.enable(id);
  }
  await kernel.activate("client");
  return { kernel, slots };
}

describe("disable cascades", () => {
  it("lists the dependents a disable would cascade to, before anything changes", async () => {
    const { kernel } = await allActive();
    expect(kernel.dependentsOf("org.example.a")).toEqual(["org.example.b", "org.example.c"]);
    expect(kernel.dependentsOf("org.example.c")).toEqual([]);
    expect(kernel.dependentsOf("org.example.d")).toEqual([]);
  });

  it("without confirmation changes nothing and reports the dependents", async () => {
    const { kernel, slots } = await allActive();
    const logs = [
      membershipLog(slots, installedFragmentsSlot),
      membershipLog(slots, enabledFragmentsSlot),
      membershipLog(slots, resolvedFragmentsSlot),
      membershipLog(slots, activeFragmentsSlot("client")),
    ];
    const error = await kernel.disable("org.example.a").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FragmentCascadeError);
    expect(error).toBeInstanceOf(FragmentLifecycleError);
    expect((error as FragmentCascadeError).id).toBe("org.example.a");
    expect((error as FragmentCascadeError).dependents).toEqual(["org.example.b", "org.example.c"]);
    for (const log of logs) expect(log.events).toEqual([]);
  });

  it("with confirmation cascades: the dependents deactivate and become unresolved, nothing else moves", async () => {
    const { kernel, slots } = await allActive();
    const active = membershipLog(slots, activeFragmentsSlot("client"));
    await kernel.disable("org.example.a", { cascade: true });
    expect(active.events).toEqual(["-org.example.c", "-org.example.b", "-org.example.a"]);
    expect(ids(slots.getSnapshot(resolvedFragmentsSlot))).toEqual(["org.example.d"]);
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client")))).toEqual(["org.example.d"]);
  });
});
