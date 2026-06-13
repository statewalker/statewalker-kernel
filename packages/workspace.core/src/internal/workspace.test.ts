import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it, vi } from "vitest";
import { Workspace, type WorkspaceAdapter } from "../public/types/workspace.js";

class FakeAdapter implements WorkspaceAdapter {
  static instances = 0;
  readonly id: number;
  readonly closed = vi.fn();
  constructor() {
    FakeAdapter.instances += 1;
    this.id = FakeAdapter.instances;
  }
  async close(): Promise<void> {
    this.closed();
  }
}

describe("Workspace — registry semantics", () => {
  it("requireAdapter returns a single cached instance; getAdapter returns the same", () => {
    FakeAdapter.instances = 0;
    const ws = new Workspace();
    ws.setAdapter(FakeAdapter);

    const first = ws.requireAdapter(FakeAdapter);
    const second = ws.requireAdapter(FakeAdapter);
    const third = ws.getAdapter(FakeAdapter);

    expect(first).toBe(second);
    expect(first).toBe(third);
    expect(FakeAdapter.instances).toBe(1);
  });

  it("auto-instantiates concrete tokens without explicit setAdapter", () => {
    FakeAdapter.instances = 0;
    const ws = new Workspace();

    const first = ws.requireAdapter(FakeAdapter);
    const second = ws.getAdapter(FakeAdapter);

    expect(first).toBe(second);
    expect(FakeAdapter.instances).toBe(1);
  });

  it("setAdapter is lazy — ctor not called until getAdapter/requireAdapter", () => {
    const spy = vi.fn();
    class Spied implements WorkspaceAdapter {
      constructor() {
        spy();
      }
    }

    const ws = new Workspace();
    ws.setAdapter(Spied);
    expect(spy).not.toHaveBeenCalled();

    ws.requireAdapter(Spied);
    expect(spy).toHaveBeenCalledTimes(1);

    ws.requireAdapter(Spied);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("Workspace — lifecycle invariants", () => {
  it("starts closed; reading .files before setFileSystem throws", () => {
    const ws = new Workspace();
    expect(ws.isOpened).toBe(false);
    expect(() => ws.files).toThrow(/no file system/i);
  });

  it("open() without setFileSystem throws", async () => {
    const ws = new Workspace();
    await expect(ws.open()).rejects.toThrow(/file system/i);
  });

  it("setFileSystem while opened throws", async () => {
    const ws = new Workspace();
    ws.setFileSystem(new MemFilesApi(), "A");
    await ws.open();
    expect(() => ws.setFileSystem(new MemFilesApi(), "B")).toThrow(/only legal while closed/i);
  });

  it("double open() is a no-op; onLoad fires once per actual open", async () => {
    const ws = new Workspace();
    ws.setFileSystem(new MemFilesApi(), "A");
    const cb = vi.fn();
    ws.onLoad(cb);

    await ws.open();
    await ws.open();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("close() does not tear down adapter instances", async () => {
    const ws = new Workspace();
    ws.setFileSystem(new MemFilesApi(), "A");
    ws.setAdapter(FakeAdapter);
    await ws.open();
    const adapter = ws.requireAdapter(FakeAdapter);

    await ws.close();
    await ws.close();
    expect(adapter.closed).not.toHaveBeenCalled();
  });
});

describe("Workspace — adapter persistence across cycles", () => {
  it("requireAdapter returns the same instance after close + open", async () => {
    const ws = new Workspace();
    ws.setFileSystem(new MemFilesApi(), "A");
    ws.setAdapter(FakeAdapter);
    await ws.open();
    const before = ws.requireAdapter(FakeAdapter);

    await ws.close();
    await ws.open();
    const after = ws.requireAdapter(FakeAdapter);

    expect(after).toBe(before);
    expect(before.closed).not.toHaveBeenCalled();
  });

  it("close() fires onUnload but does not call adapter.close()", async () => {
    class A implements WorkspaceAdapter {
      closed = vi.fn();
      async close() {
        this.closed();
      }
    }

    const events: string[] = [];
    const ws = new Workspace();
    ws.setFileSystem(new MemFilesApi(), "X");
    ws.setAdapter(A);
    await ws.open();

    const a = ws.requireAdapter(A);
    a.closed.mockImplementation(() => events.push("adapter.close"));
    ws.onUnload(() => events.push("unload"));

    await ws.close();

    expect(events).toEqual(["unload"]);
  });
});

describe("Workspace — onLoad state-aware fire", () => {
  it("fires immediately when subscribed on an already-opened workspace", async () => {
    const ws = new Workspace();
    ws.setFileSystem(new MemFilesApi(), "A");
    await ws.open();

    const cb = vi.fn();
    ws.onLoad(cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("fires on the next open() when subscribed on a closed workspace", async () => {
    const ws = new Workspace();
    ws.setFileSystem(new MemFilesApi(), "A");

    const cb = vi.fn();
    ws.onLoad(cb);
    expect(cb).not.toHaveBeenCalled();

    await ws.open();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe("Workspace — onUnload event-only fire", () => {
  it("does not fire on subscription even if opened; fires on close", async () => {
    const ws = new Workspace();
    ws.setFileSystem(new MemFilesApi(), "A");
    await ws.open();

    const cb = vi.fn();
    ws.onUnload(cb);
    expect(cb).not.toHaveBeenCalled();

    await ws.close();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does not fire when close() runs while already closed", async () => {
    const ws = new Workspace();
    const cb = vi.fn();
    ws.onUnload(cb);
    await ws.close();
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("Workspace — rebind sequence", () => {
  it("fires setup → teardown → setup across close + setFileSystem + open", async () => {
    const ws = new Workspace();
    ws.setFileSystem(new MemFilesApi(), "A");

    const order: string[] = [];
    ws.onLoad(() => order.push("load"));
    ws.onUnload(() => order.push("unload"));

    await ws.open();
    await ws.close();
    ws.setFileSystem(new MemFilesApi(), "B");
    await ws.open();

    expect(order).toEqual(["load", "unload", "load"]);
  });
});

describe("Workspace — re-registration during open", () => {
  abstract class Token implements WorkspaceAdapter {
    abstract readonly tag: string;
    closed = vi.fn();
    async close(): Promise<void> {
      this.closed();
    }
  }
  class FirstImpl extends Token {
    readonly tag = "first";
  }
  class SecondImpl extends Token {
    readonly tag = "second";
  }

  it("closes the previously-cached instance before replacing the registration", async () => {
    const ws = new Workspace();
    ws.setFileSystem(new MemFilesApi(), "A");
    ws.setAdapter(Token, FirstImpl);
    await ws.open();

    const original = ws.requireAdapter(Token);
    expect(original.tag).toBe("first");

    ws.setAdapter(Token, SecondImpl);
    await Promise.resolve();
    await Promise.resolve();
    expect(original.closed).toHaveBeenCalledTimes(1);

    const replacement = ws.requireAdapter(Token);
    expect(replacement).toBeInstanceOf(SecondImpl);
    expect(replacement.tag).toBe("second");
  });
});
