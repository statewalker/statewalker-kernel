import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it } from "vitest";
import {
  ConsoleLoggerAdapter,
  type Logger,
  LoggerAdapter,
  loggerOf,
} from "../public/types/logger.js";
import { Workspace } from "../public/types/workspace.js";

/** A LoggerAdapter that records what newLogger() was asked for. */
class RecordingLoggerAdapter extends LoggerAdapter {
  keys: string[] = [];
  newLogger(key: string): Logger {
    this.keys.push(key);
    return super.newLogger(key);
  }
}

async function workspaceWithProject(): Promise<Workspace> {
  const fs = new MemFilesApi();
  await fs.write("/proj/a.txt", [new TextEncoder().encode("a")]);
  const ws = new Workspace();
  ws.setFileSystem(fs, "WS");
  await ws.open();
  return ws;
}

describe("loggerOf", () => {
  it("falls back to a working no-op logger when no adapter is registered", async () => {
    const ws = await workspaceWithProject();
    const project = await ws.getProject("proj");
    const log = loggerOf(project, "scanner");
    expect(() => log.info("hello")).not.toThrow();
  });

  it("resolves a registered project-level LoggerAdapter and passes the key", async () => {
    const ws = await workspaceWithProject();
    const recorder = new RecordingLoggerAdapter(null);
    ws.adaptersRegistry.register("project", LoggerAdapter, () => recorder);

    const project = await ws.getProject("proj");
    loggerOf(project, "build");
    expect(recorder.keys).toContain("build");
  });
});

describe("ConsoleLoggerAdapter — metadata", () => {
  it("stamps project + workspace metadata derived from the host", () => {
    const host = { projectName: "proj", workspace: { label: "WS" } };
    const adapter = new ConsoleLoggerAdapter(host);
    expect(adapter.meta).toEqual({ project: "proj", workspace: "WS" });
  });

  it("stamps workspace label for a workspace host", () => {
    const adapter = new ConsoleLoggerAdapter({ label: "WS" });
    expect(adapter.meta).toEqual({ workspace: "WS" });
  });
});
