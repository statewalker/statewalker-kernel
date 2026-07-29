import type { FilesApi } from "@statewalker/webrun-files";
import { readText, writeText } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { initWorkspace, SystemFiles, Workspace } from "@statewalker/workspace.core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LayoutStore } from "../public/layout-store.js";

const LEGACY_KEY = "chat-mini:dock-layout";

/** A FilesApi that delegates to `inner` but counts `write` calls (and can force writes to reject). */
class CountingFilesApi implements FilesApi {
  writeCount = 0;
  failWrites = false;
  constructor(private readonly inner: FilesApi) {}
  read(path: string, o?: Parameters<FilesApi["read"]>[1]) {
    return this.inner.read(path, o);
  }
  write(path: string, content: Parameters<FilesApi["write"]>[1]) {
    this.writeCount++;
    if (this.failWrites) return Promise.reject(new Error("disk full"));
    return this.inner.write(path, content);
  }
  mkdir(p: string) {
    return this.inner.mkdir(p);
  }
  list(p: string, o?: Parameters<FilesApi["list"]>[1]) {
    return this.inner.list(p, o);
  }
  stats(p: string) {
    return this.inner.stats(p);
  }
  exists(p: string) {
    return this.inner.exists(p);
  }
  remove(p: string) {
    return this.inner.remove(p);
  }
  move(s: string, t: string) {
    return this.inner.move(s, t);
  }
  copy(s: string, t: string) {
    return this.inner.copy(s, t);
  }
}

function makeWorkspace(): { workspace: Workspace; counting: CountingFilesApi; sysFiles: FilesApi } {
  const counting = new CountingFilesApi(new MemFilesApi());
  const workspace = initWorkspace({ workspace: new Workspace(), filesApi: counting });
  const sysFiles = workspace.requireAdapter(SystemFiles).files;
  return { workspace, counting, sysFiles };
}

/** Drain the coalesced write path: microtask → setTimeout(0). */
async function settleWrites(): Promise<void> {
  await new Promise<void>((r) => queueMicrotask(r));
  await new Promise<void>((r) => setTimeout(r, 0));
  await new Promise<void>((r) => setTimeout(r, 0));
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  vi.unstubAllGlobals();
});

describe("LayoutStore", () => {
  it("get() reflects the in-memory layout set via set()", () => {
    const { workspace } = makeWorkspace();
    const store = workspace.requireAdapter(LayoutStore);
    expect(store.get()).toBeNull();
    store.set({ panels: { a: {} } });
    expect(store.get()).toEqual({ panels: { a: {} } });
  });

  it("coalesces rapid set() calls into a single write", async () => {
    const { workspace, counting } = makeWorkspace();
    const store = workspace.requireAdapter(LayoutStore);
    store.set({ v: 1 });
    store.set({ v: 2 });
    store.set({ v: 3 });
    await settleWrites();
    expect(counting.writeCount).toBe(1);
    const written = JSON.parse(await readText(counting, "/.settings/dock-layout.json"));
    expect(written).toEqual({ v: 3 });
  });

  it("connect(): an existing file wins and is NOT overwritten", async () => {
    const { workspace, counting, sysFiles } = makeWorkspace();
    await writeText(sysFiles, "/dock-layout.json", JSON.stringify({ from: "file" }));
    const before = counting.writeCount;
    const store = workspace.requireAdapter(LayoutStore);
    await store.connect();
    expect(store.get()).toEqual({ from: "file" });
    // Load-then-conditional-flush: a present file is authoritative — connect writes nothing.
    expect(counting.writeCount).toBe(before);
  });

  it("connect(): an absent file is seeded from the in-memory layout", async () => {
    const { workspace, counting, sysFiles } = makeWorkspace();
    const store = workspace.requireAdapter(LayoutStore);
    store.set({ seed: true });
    await settleWrites();
    // Delete the file the set() persisted, so connect sees no file but keeps the in-memory layout.
    await sysFiles.remove("/dock-layout.json");
    expect(await sysFiles.exists("/dock-layout.json")).toBe(false);
    counting.writeCount = 0;
    await store.connect();
    await settleWrites();
    expect(await sysFiles.exists("/dock-layout.json")).toBe(true);
    expect(JSON.parse(await readText(sysFiles, "/dock-layout.json"))).toEqual({ seed: true });
    expect(counting.writeCount).toBeGreaterThanOrEqual(1);
  });

  it("connect(): migrates a legacy localStorage layout once, then never re-reads it", async () => {
    const { workspace, sysFiles } = makeWorkspace();
    const legacy = { migrated: "layout" };
    const getItem = vi.fn((k: string) => (k === LEGACY_KEY ? JSON.stringify(legacy) : null));
    vi.stubGlobal("localStorage", { getItem, setItem: vi.fn(), removeItem: vi.fn() });

    const store = workspace.requireAdapter(LayoutStore);
    await store.connect();
    await settleWrites();
    expect(store.get()).toEqual(legacy);
    expect(JSON.parse(await readText(sysFiles, "/dock-layout.json"))).toEqual(legacy);
    expect(getItem).toHaveBeenCalled();

    // Second connect: the file now exists, so localStorage must NOT be consulted again.
    getItem.mockClear();
    await store.connect();
    expect(getItem).not.toHaveBeenCalled();
    expect(store.get()).toEqual(legacy);
  });

  it("connect(): a missing localStorage is not an error", async () => {
    const { workspace } = makeWorkspace();
    vi.stubGlobal("localStorage", undefined);
    const store = workspace.requireAdapter(LayoutStore);
    await expect(store.connect()).resolves.toBeUndefined();
    expect(store.get()).toBeNull();
  });

  it("connect(): a localStorage whose getItem throws does not reject connect", async () => {
    const { workspace } = makeWorkspace();
    // Storage-disabled (e.g. Safari private mode) throws inside getItem.
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    const store = workspace.requireAdapter(LayoutStore);
    await expect(store.connect()).resolves.toBeUndefined();
    expect(store.get()).toBeNull();
  });

  it("connect(): a localStorage property access that throws (sandboxed iframe) does not reject connect", async () => {
    const { workspace } = makeWorkspace();
    // A sandboxed iframe throws SecurityError on the property access itself.
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError: access to localStorage is blocked");
      },
    });
    try {
      const store = workspace.requireAdapter(LayoutStore);
      await expect(store.connect()).resolves.toBeUndefined();
      expect(store.get()).toBeNull();
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it("connect(): a corrupt file falls back to the default layout without throwing", async () => {
    const { workspace, sysFiles } = makeWorkspace();
    await writeText(sysFiles, "/dock-layout.json", "not json{{{");
    const store = workspace.requireAdapter(LayoutStore);
    await expect(store.connect()).resolves.toBeUndefined();
    expect(store.get()).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("set(): a failed write is caught and logged, not thrown", async () => {
    const { workspace, counting } = makeWorkspace();
    counting.failWrites = true;
    const store = workspace.requireAdapter(LayoutStore);
    // The write path attempts the write (rejects), and the rejection is caught
    // inside the guarded `_write` — set() never throws and awaiting the coalesced
    // flush never rejects; the failure surfaces only as a logged warning.
    expect(() => store.set({ v: 1 })).not.toThrow();
    await expect(settleWrites()).resolves.toBeUndefined();
    expect(counting.writeCount).toBeGreaterThanOrEqual(1);
    expect(warnSpy).toHaveBeenCalled();
  });
});
