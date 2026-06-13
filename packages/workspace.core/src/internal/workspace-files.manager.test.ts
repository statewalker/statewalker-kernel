import { Commands } from "@statewalker/shared-commands";
import { readText, writeText } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it } from "vitest";
import {
  DeleteFileCommand,
  LoadDirectoryCommand,
  LoadFileCommand,
  MoveFileCommand,
  WriteFileCommand,
} from "../public/files-commands.js";
import { Workspace } from "../public/types/workspace.js";
import { WorkspaceFilesManager } from "./workspace-files.manager.js";

function boot(files: MemFilesApi): { ws: Workspace; manager: WorkspaceFilesManager } {
  const ws = new Workspace();
  ws.setFileSystem(files, "test");
  const manager = new WorkspaceFilesManager({ workspace: ws });
  return { ws, manager };
}

describe("WorkspaceFilesManager", () => {
  it("load-directory lists workspace.files entries with mime types", async () => {
    const files = new MemFilesApi();
    await writeText(files, "/notes/hello.md", "# hi");
    await writeText(files, "/notes/data.json", '{"k":1}');
    const { ws, manager } = boot(files);
    await ws.open();
    const commands = ws.requireAdapter(Commands);

    const entries = await commands.call(LoadDirectoryCommand, { path: "/notes" }).promise;
    expect(entries.map((e) => e.name).sort()).toEqual(["data.json", "hello.md"]);
    expect(entries.find((e) => e.name === "hello.md")?.mimeType).toBe("text/markdown");
    expect(entries.find((e) => e.name === "data.json")?.mimeType).toBe("application/json");

    manager.dispose();
  });

  it("load-file / write-file / delete-file round-trip", async () => {
    const files = new MemFilesApi();
    const { ws, manager } = boot(files);
    await ws.open();
    const commands = ws.requireAdapter(Commands);

    await commands.call(WriteFileCommand, { path: "/a.txt", content: "hello" }).promise;
    const loaded = await commands.call(LoadFileCommand, { path: "/a.txt" }).promise;
    expect(new TextDecoder().decode(loaded.bytes)).toBe("hello");
    expect(loaded.mimeType).toBe("text/plain");

    await commands.call(DeleteFileCommand, { path: "/a.txt" }).promise;
    expect(await files.exists("/a.txt")).toBe(false);

    manager.dispose();
  });

  it("move-file renames a file", async () => {
    const files = new MemFilesApi();
    await writeText(files, "/a.md", "old");
    const { ws, manager } = boot(files);
    await ws.open();
    const commands = ws.requireAdapter(Commands);

    await commands.call(MoveFileCommand, { fromPath: "/a.md", toPath: "/b.md" }).promise;
    expect(await files.exists("/a.md")).toBe(false);
    expect(await readText(files, "/b.md")).toBe("old");

    manager.dispose();
  });

  it("commands reject when the workspace is closed", async () => {
    const files = new MemFilesApi();
    const { ws, manager } = boot(files);
    const commands = ws.requireAdapter(Commands);
    await expect(commands.call(LoadDirectoryCommand, {}).promise).rejects.toThrow(/open workspace/);
    manager.dispose();
    void ws;
  });
});
