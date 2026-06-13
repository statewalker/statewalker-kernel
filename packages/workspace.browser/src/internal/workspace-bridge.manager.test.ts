import { Commands } from "@statewalker/shared-commands";
import { ChangeWorkspaceCommand, getWorkspace } from "@statewalker/workspace.core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceDisconnectCommand, WorkspaceReconnectCommand } from "../public/commands.js";
import initWorkspaceBridge from "../public/init.js";
import { WorkspaceShellAdapter } from "./workspace-shell-adapter.js";

vi.mock("idb-keyval", () => {
  let store: unknown;
  return {
    get: vi.fn(async () => store),
    set: vi.fn(async (_key: string, value: unknown) => {
      store = value;
    }),
    del: vi.fn(async () => {
      store = undefined;
    }),
    __reset: () => {
      store = undefined;
    },
  };
});

vi.mock("@statewalker/webrun-files-browser", () => ({
  BrowserFilesApi: class FakeFilesApi {
    constructor(public readonly opts: unknown) {}
  },
}));

interface FakeHandle {
  name: string;
  queryPermission: ReturnType<typeof vi.fn>;
  requestPermission: ReturnType<typeof vi.fn>;
}

function makeHandle(
  name: string,
  query: PermissionState,
  request: PermissionState = "granted",
): FakeHandle {
  return {
    name,
    queryPermission: vi.fn(async () => query),
    requestPermission: vi.fn(async () => request),
  };
}

async function getModule(): Promise<typeof import("idb-keyval")> {
  return await import("idb-keyval");
}

async function resetIdb(): Promise<void> {
  const mod = (await getModule()) as unknown as { __reset?: () => void };
  mod.__reset?.();
}

async function setIdbHandle(handle: FakeHandle | undefined): Promise<void> {
  const mod = await getModule();
  if (handle === undefined) {
    await mod.del("anything");
  } else {
    await mod.set("chat-mini:workspace-handle", handle as unknown as object);
  }
}

beforeEach(() => {
  vi.stubGlobal("window", {
    ...window,
    showDirectoryPicker: vi.fn(),
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  await resetIdb();
});

async function settle(): Promise<void> {
  // Silent-restore is fired from the manager constructor as a
  // floating promise. Yield repeatedly so all awaits inside it
  // resolve before assertions run.
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

describe("WorkspaceBridgeManager — silent-restore + command handlers", () => {
  it("silent-restore with granted permission transitions loading → ready and fires runChangeWorkspace", async () => {
    const handle = makeHandle("my-folder", "granted");
    await setIdbHandle(handle);

    const ctx: Record<string, unknown> = {};
    const cleanup = initWorkspaceBridge(ctx);
    try {
      const ws = getWorkspace(ctx);
      const shell = ws.requireAdapter(WorkspaceShellAdapter);

      // Constructor schedules silent-restore — let it run.
      await settle();
      // The manager's `_adoptHandle` awaits `runChangeWorkspace`,
      // which awaits `workspace.open()` — both async — so settle
      // again to allow the chain to resolve.
      await settle();

      expect(shell.getState()).toEqual({ status: "ready", label: "my-folder" });
      expect(ws.isOpened).toBe(true);
      expect(ws.label).toBe("my-folder");
    } finally {
      await cleanup();
    }
  });

  it("silent-restore with prompt permission transitions loading → needs-permission and does NOT fire runChangeWorkspace", async () => {
    const handle = makeHandle("waiting-folder", "prompt");
    await setIdbHandle(handle);

    const ctx: Record<string, unknown> = {};
    const cleanup = initWorkspaceBridge(ctx);
    try {
      const ws = getWorkspace(ctx);
      const shell = ws.requireAdapter(WorkspaceShellAdapter);

      await settle();

      expect(shell.getState()).toEqual({
        status: "needs-permission",
        label: "waiting-folder",
      });
      expect(ws.isOpened).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("interactive workspace:change picks the directory itself, persists the handle, and transitions to ready", async () => {
    const ctx: Record<string, unknown> = {};
    const cleanup = initWorkspaceBridge(ctx);
    try {
      const ws = getWorkspace(ctx);
      const commands = ws.requireAdapter(Commands);
      const shell = ws.requireAdapter(WorkspaceShellAdapter);

      await settle(); // silent-restore → empty
      expect(shell.getState()).toEqual({ status: "empty" });

      const pickedHandle = makeHandle("picked-folder", "granted");
      const showDirectoryPicker = vi.fn(async () => pickedHandle);
      vi.stubGlobal("window", {
        ...window,
        showDirectoryPicker,
      });

      await commands.call(ChangeWorkspaceCommand, {}).promise;
      await settle();

      expect(showDirectoryPicker).toHaveBeenCalledOnce();
      expect(shell.getState()).toEqual({
        status: "ready",
        label: "picked-folder",
      });
      expect(ws.isOpened).toBe(true);
      expect(ws.label).toBe("picked-folder");

      // Handle is persisted so a future reload silent-restores it.
      const idb = await getModule();
      const stored = await idb.get("chat-mini:workspace-handle");
      expect(stored).toBe(pickedHandle);
    } finally {
      await cleanup();
    }
  });

  it("silent-restore with no stored handle transitions to empty", async () => {
    const ctx: Record<string, unknown> = {};
    const cleanup = initWorkspaceBridge(ctx);
    try {
      const ws = getWorkspace(ctx);
      const shell = ws.requireAdapter(WorkspaceShellAdapter);

      await settle();

      expect(shell.getState()).toEqual({ status: "empty" });
    } finally {
      await cleanup();
    }
  });

  it("workspace:disconnect closes the workspace, clears the stored handle, and transitions to empty", async () => {
    const handle = makeHandle("connected-folder", "granted");
    await setIdbHandle(handle);

    const ctx: Record<string, unknown> = {};
    const cleanup = initWorkspaceBridge(ctx);
    try {
      const ws = getWorkspace(ctx);
      const commands = ws.requireAdapter(Commands);
      const shell = ws.requireAdapter(WorkspaceShellAdapter);

      await settle();
      await settle();
      expect(shell.getState().status).toBe("ready");
      expect(ws.isOpened).toBe(true);

      await commands.call(WorkspaceDisconnectCommand, {}).promise;

      expect(shell.getState()).toEqual({ status: "empty" });
      expect(ws.isOpened).toBe(false);
      const idb = await getModule();
      const storedAfter = await idb.get("chat-mini:workspace-handle");
      expect(storedAfter).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it("workspace:reconnect on a needs-permission state requests permission and transitions to ready on grant", async () => {
    const handle = makeHandle("prompted-folder", "prompt", "granted");
    await setIdbHandle(handle);

    const ctx: Record<string, unknown> = {};
    const cleanup = initWorkspaceBridge(ctx);
    try {
      const ws = getWorkspace(ctx);
      const commands = ws.requireAdapter(Commands);
      const shell = ws.requireAdapter(WorkspaceShellAdapter);

      await settle();
      expect(shell.getState().status).toBe("needs-permission");

      const reconnect = commands.call(WorkspaceReconnectCommand, {});
      await reconnect.promise;
      // _adoptHandle internally awaits runChangeWorkspace which is
      // itself awaited inside the handler — but the resolve happens
      // from within the floating .then chain in registerChangeWorkspaceHandler.
      await settle();

      expect(shell.getState()).toEqual({
        status: "ready",
        label: "prompted-folder",
      });
      expect(handle.requestPermission).toHaveBeenCalledOnce();
    } finally {
      await cleanup();
    }
  });

  it("re-entrant initWorkspaceBridge cycles do not leak command handlers or shell-adapter listeners", async () => {
    const handle = makeHandle("re-entrant", "granted");
    await setIdbHandle(handle);

    const ctx: Record<string, unknown> = {};

    // ── Cycle 1 ──
    const cleanup1 = initWorkspaceBridge(ctx);
    const ws = getWorkspace(ctx);
    const commands = ws.requireAdapter(Commands);
    const shell = ws.requireAdapter(WorkspaceShellAdapter);

    await settle();
    await settle();
    expect(shell.getState().status).toBe("ready");

    // Disconnect the handlers + workspace.
    await commands.call(WorkspaceDisconnectCommand, {}).promise;
    expect(shell.getState().status).toBe("empty");

    await cleanup1();

    // ── Cycle 2 ──
    // Restore the handle so silent-restore has work to do.
    await setIdbHandle(handle);

    const cleanup2 = initWorkspaceBridge(ctx);
    try {
      await settle();
      await settle();

      expect(shell.getState()).toEqual({
        status: "ready",
        label: "re-entrant",
      });
      // After two cycles the workspace should have a single set of
      // active command handlers — firing disconnect once should
      // transition cleanly to `empty` rather than throwing or
      // double-handling.
      await commands.call(WorkspaceDisconnectCommand, {}).promise;
      expect(shell.getState()).toEqual({ status: "empty" });
    } finally {
      await cleanup2();
    }
  });
});
