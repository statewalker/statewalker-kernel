import { Commands } from "@statewalker/shared-commands";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { afterEach, describe, expect, it } from "vitest";
import { ChangeWorkspaceCommand } from "../public/commands.js";
import initWorkspaceApi from "../public/init.js";
import { PickDirectoryCommand, type PickDirectoryResult } from "../public/pick-directory.js";
import { getWorkspace } from "../public/types/workspace.js";

class UserCancelledError extends Error {
  readonly name = "UserCancelledError";
}

interface PickStub {
  files: MemFilesApi;
  label: string;
}

function registerPickStub(commands: Commands, picks: PickStub[] | { error: Error }): () => void {
  const queue = Array.isArray(picks) ? [...picks] : null;
  return commands.listen(PickDirectoryCommand, (command) => {
    if (!Array.isArray(picks)) {
      command.reject(picks.error);
      return true;
    }
    const next = queue?.shift();
    if (!next) {
      command.reject(new Error("pick-directory queue exhausted"));
      return true;
    }
    command.resolve({
      files: next.files,
      label: next.label,
    } satisfies PickDirectoryResult);
    return true;
  });
}

describe("workspace:change — non-interactive payload", () => {
  let cleanups: Array<() => void> = [];

  afterEach(() => {
    for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]?.();
    cleanups = [];
  });

  it("rebinds non-interactively when payload.files is supplied (cold start)", async () => {
    const ctx: Record<string, unknown> = {};
    const commands = getWorkspace(ctx).requireAdapter(Commands);
    cleanups.push(initWorkspaceApi(ctx));

    const memFs = new MemFilesApi();
    const { workspace } = await commands.call(ChangeWorkspaceCommand, {
      files: memFs,
      label: "boot",
    }).promise;

    expect(workspace.isOpened).toBe(true);
    expect(workspace.label).toBe("boot");
    expect(workspace.files).toBe(memFs);
  });

  it("preserves workspace identity across rebinds", async () => {
    const ctx: Record<string, unknown> = {};
    const commands = getWorkspace(ctx).requireAdapter(Commands);
    cleanups.push(initWorkspaceApi(ctx));

    const first = new MemFilesApi();
    const { workspace } = await commands.call(ChangeWorkspaceCommand, {
      files: first,
      label: "first",
    }).promise;
    expect(workspace.files).toBe(first);

    const second = new MemFilesApi();
    const { workspace: rebinded } = await commands.call(ChangeWorkspaceCommand, {
      files: second,
      label: "second",
    }).promise;

    expect(rebinded).toBe(workspace);
    expect(rebinded.files).toBe(second);
    expect(rebinded.label).toBe("second");
    expect(rebinded.isOpened).toBe(true);
  });

  it("defaults the label to 'Workspace' when payload.label is omitted", async () => {
    const ctx: Record<string, unknown> = {};
    const commands = getWorkspace(ctx).requireAdapter(Commands);
    cleanups.push(initWorkspaceApi(ctx));

    const memFs = new MemFilesApi();
    const { workspace } = await commands.call(ChangeWorkspaceCommand, { files: memFs }).promise;
    expect(workspace.label).toBe("Workspace");
  });
});

describe("workspace:change — interactive (pick-directory)", () => {
  let cleanups: Array<() => void> = [];

  afterEach(() => {
    for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]?.();
    cleanups = [];
  });

  it("opens the workspace against the user-picked files when no payload supplied", async () => {
    const ctx: Record<string, unknown> = {};
    const commands = getWorkspace(ctx).requireAdapter(Commands);
    const picked = new MemFilesApi();
    cleanups.push(registerPickStub(commands, [{ files: picked, label: "P" }]));
    cleanups.push(initWorkspaceApi(ctx));

    const { workspace } = await commands.call(ChangeWorkspaceCommand, {}).promise;
    expect(workspace.isOpened).toBe(true);
    expect(workspace.label).toBe("P");
    expect(workspace.files).toBe(picked);
  });

  it("propagates UserCancelledError when the picker rejects", async () => {
    const ctx: Record<string, unknown> = {};
    const commands = getWorkspace(ctx).requireAdapter(Commands);
    cleanups.push(registerPickStub(commands, { error: new UserCancelledError("nope") }));
    cleanups.push(initWorkspaceApi(ctx));

    await expect(commands.call(ChangeWorkspaceCommand, {}).promise).rejects.toBeInstanceOf(
      UserCancelledError,
    );
    expect(getWorkspace(ctx).isOpened).toBe(false);
  });
});
