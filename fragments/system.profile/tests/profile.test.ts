// Seam 1: the system.profile core fragment through the real kernel, and its store through its
// public interface (get, set, delete, keys) over Web Storage or memory.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { activeFragmentsSlot, createKernel, parseJsonc } from "@statewalker/kernel.core";
import { describe, expect, it } from "vitest";
import {
  createMemoryStorage,
  createStorageProfile,
  createSystemProfile,
  SYSTEM_PROFILE_ID,
  systemProfileArchive,
} from "../src/index.js";

describe("the system.profile fragment", () => {
  it("is a core fragment the kernel installs and activates", async () => {
    const system = createSystemProfile();
    const kernel = createKernel({
      platform: { version: "1.0.0", bindings: [] },
      core: [systemProfileArchive],
      activators: {
        client: (f, context) => (f.id === SYSTEM_PROFILE_ID ? system.activate(context) : undefined),
      },
    });
    await kernel.start();
    await kernel.activate("client");
    expect([...kernel.slots.getSnapshot(activeFragmentsSlot("client")).keys()]).toEqual([
      SYSTEM_PROFILE_ID,
    ]);
  });

  it("ships the archive its folder holds", () => {
    const root = join(import.meta.dirname, "..");
    for (const file of ["fragment.jsonc", "fragment.client.jsonc"]) {
      const onDisk = parseJsonc(readFileSync(join(root, file), "utf8")).value;
      expect(onDisk).toEqual(JSON.parse(systemProfileArchive[file] ?? "null"));
    }
  });

  it("keeps the kernel's records: its store is a KernelProfile", async () => {
    const { store } = createSystemProfile();
    const kernel = createKernel({
      platform: { version: "1.0.0", bindings: [] },
      core: [systemProfileArchive],
      profile: store,
    });
    await kernel.start();
    expect(store.keys("fragments/")).toEqual([`fragments/${SYSTEM_PROFILE_ID}`]);
    expect(store.get(`fragments/${SYSTEM_PROFILE_ID}`)).toMatchObject({
      version: "0.1.0",
      enabled: true,
    });
  });
});

describe("the profile store", () => {
  it("keeps JSON values under keys, copied in and out", () => {
    const store = createStorageProfile(createMemoryStorage());
    const value = { zones: { center: ["a/b"] } };
    store.set("workbench/layouts/desktop", value);
    value.zones.center.push("c/d");
    const read = store.get("workbench/layouts/desktop") as typeof value;
    expect(read).toEqual({ zones: { center: ["a/b"] } });
    read.zones.center.push("x/y");
    expect(store.get("workbench/layouts/desktop")).toEqual({ zones: { center: ["a/b"] } });
    expect(store.get("missing")).toBeUndefined();
    store.delete("workbench/layouts/desktop");
    expect(store.get("workbench/layouts/desktop")).toBeUndefined();
  });

  it("lists its keys, by prefix, and only its own in a shared storage", () => {
    const storage = createMemoryStorage();
    storage.setItem("someone-else", "1");
    const store = createStorageProfile(storage, "app:");
    store.set("workbench/layouts/phone", {});
    store.set("workbench/layouts/desktop", {});
    store.set("fragments/org.x", { enabled: true });
    expect(storage.getItem("app:fragments/org.x")).toBe('{"enabled":true}');
    expect(store.keys().sort()).toEqual([
      "fragments/org.x",
      "workbench/layouts/desktop",
      "workbench/layouts/phone",
    ]);
    expect(store.keys("workbench/layouts/").sort()).toEqual([
      "workbench/layouts/desktop",
      "workbench/layouts/phone",
    ]);
  });

  it("survives a new store over the same storage (a reload)", () => {
    const storage = createMemoryStorage();
    createStorageProfile(storage, "app:").set("k", [1, 2]);
    expect(createStorageProfile(storage, "app:").get("k")).toEqual([1, 2]);
    expect(createStorageProfile(storage, "other:").get("k")).toBeUndefined();
  });

  it("reads a value that is not JSON as absent, and refuses a value JSON cannot hold", () => {
    const storage = createMemoryStorage();
    storage.setItem("app:broken", "{not json");
    const store = createStorageProfile(storage, "app:");
    expect(store.get("broken")).toBeUndefined();
    expect(() => store.set("u", undefined)).toThrow(TypeError);
  });
});
