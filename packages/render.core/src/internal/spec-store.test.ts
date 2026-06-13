import { Commands } from "@statewalker/shared-commands";
import { getWorkspace } from "@statewalker/workspace.core";
import { describe, expect, it, vi } from "vitest";
import { CreateSpecCommand, PatchSpecCommand } from "../public/commands.js";
import initSpecStore from "../public/init.js";
import { SpecStore } from "../public/spec-store.js";

describe("SpecStore", () => {
  it("create with caller-supplied id stores under that id", () => {
    const store = new SpecStore();
    const id = store.create({
      id: "spec:custom",
      catalogId: "c",
      spec: { foo: 1 },
    });
    expect(id).toBe("spec:custom");
    const rec = store.get("spec:custom");
    expect(rec).not.toBeNull();
    expect(rec?.catalogId).toBe("c");
    expect(rec?.spec).toEqual({ foo: 1 });
  });

  it("create with duplicate caller-supplied id throws", () => {
    const store = new SpecStore();
    store.create({ id: "spec:dup", catalogId: "c", spec: 1 });
    expect(() => store.create({ id: "spec:dup", catalogId: "c2", spec: 2 })).toThrow();
  });

  it("create without id generates a `spec:` id", () => {
    const store = new SpecStore();
    const id = store.create({ catalogId: "c", spec: 1 });
    expect(id).toMatch(/^spec:/);
    expect(store.get(id)).not.toBeNull();
  });

  it("get returns referentially stable record across calls", () => {
    const store = new SpecStore();
    const id = store.create({ id: "spec:s", catalogId: "c", spec: 1 });
    expect(store.get(id)).toBe(store.get(id));
  });

  it("patch invalidates the stable reference and notifies observers", () => {
    const store = new SpecStore();
    const id = store.create({ id: "spec:s", catalogId: "c", spec: 1 });
    const before = store.get(id);
    const cb = vi.fn();
    store.observe(id, cb);
    store.patch(id, { spec: 2 });
    expect(cb).toHaveBeenCalledTimes(1);
    const after = store.get(id);
    expect(after).not.toBe(before);
    expect(after?.spec).toBe(2);
    expect(after?.catalogId).toBe("c"); // unchanged
  });

  it("patch can update catalogId and meta independently", () => {
    const store = new SpecStore();
    const id = store.create({
      id: "spec:s",
      catalogId: "c1",
      spec: 1,
      meta: { a: 1 },
    });
    store.patch(id, { catalogId: "c2" });
    expect(store.get(id)?.catalogId).toBe("c2");
    store.patch(id, { meta: { b: 2 } });
    expect(store.get(id)?.meta).toEqual({ b: 2 });
  });

  it("delete notifies observers and get returns null after", () => {
    const store = new SpecStore();
    const id = store.create({ id: "spec:s", catalogId: "c", spec: 1 });
    const cb = vi.fn();
    store.observe(id, cb);
    store.delete(id);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(store.get(id)).toBeNull();
  });

  it("observe disposer stops further notifications", () => {
    const store = new SpecStore();
    const id = store.create({ id: "spec:s", catalogId: "c", spec: 1 });
    const cb = vi.fn();
    const dispose = store.observe(id, cb);
    dispose();
    store.patch(id, { spec: 2 });
    expect(cb).not.toHaveBeenCalled();
  });

  it("observe does not fire at registration time", () => {
    const store = new SpecStore();
    const id = store.create({ id: "spec:s", catalogId: "c", spec: 1 });
    const cb = vi.fn();
    store.observe(id, cb);
    expect(cb).not.toHaveBeenCalled();
  });

  it("delete on unknown id is a no-op", () => {
    const store = new SpecStore();
    expect(() => store.delete("missing")).not.toThrow();
  });

  it("patch on unknown id throws", () => {
    const store = new SpecStore();
    expect(() => store.patch("missing", { spec: 1 })).toThrow();
  });
});

describe("spec:create / spec:patch commands", () => {
  it("runCreateSpec allocates and returns the id", async () => {
    const ctx: Record<string, unknown> = {};
    const cleanup = await initSpecStore(ctx);
    try {
      const ws = getWorkspace(ctx);
      const commands = ws.requireAdapter(Commands);
      const store = ws.requireAdapter(SpecStore);
      const command = commands.call(CreateSpecCommand, {
        catalogId: "c",
        spec: { hello: "world" },
      });
      const { specId } = await command.promise;
      expect(specId).toMatch(/^spec:/);
      expect(store.get(specId)?.spec).toEqual({ hello: "world" });
    } finally {
      await cleanup();
    }
  });

  it("runPatchSpec updates the stored spec and notifies observers", async () => {
    const ctx: Record<string, unknown> = {};
    const cleanup = await initSpecStore(ctx);
    try {
      const ws = getWorkspace(ctx);
      const commands = ws.requireAdapter(Commands);
      const store = ws.requireAdapter(SpecStore);
      const specId = store.create({ id: "spec:s", catalogId: "c", spec: 1 });
      const cb = vi.fn();
      store.observe(specId, cb);
      const command = commands.call(PatchSpecCommand, { specId, patch: { spec: 2 } });
      await command.promise;
      expect(store.get(specId)?.spec).toBe(2);
      expect(cb).toHaveBeenCalledTimes(1);
    } finally {
      await cleanup();
    }
  });

  it("cleanup removes the command handlers", async () => {
    const ctx: Record<string, unknown> = {};
    const cleanup = await initSpecStore(ctx);
    const ws = getWorkspace(ctx);
    const commands = ws.requireAdapter(Commands);
    const store = ws.requireAdapter(SpecStore);
    const sizeBefore = countSpecs(store);
    await cleanup();
    // After cleanup, commands.call(CreateSpecCommand, ...) falls through to
    // CreateSpecCommand's declared default (() => {}), which silently
    // resolves with no payload — critically, no SpecStore.create is
    // called anymore.
    commands.call(CreateSpecCommand, { catalogId: "c", spec: 1 });
    expect(countSpecs(store)).toBe(sizeBefore);
  });
});

function countSpecs(store: SpecStore): number {
  // Probe via observe — the only public way to detect "is anything in here?"
  // without exposing internals. For test purposes only.
  let count = 0;
  // biome-ignore lint/suspicious/noExplicitAny: inspecting private field for a test-only count
  for (const _id of (store as any)._records.keys()) {
    count += 1;
  }
  return count;
}
