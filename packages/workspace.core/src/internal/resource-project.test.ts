import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it } from "vitest";
import { Workspace } from "../public/types/workspace.js";

const enc = new TextEncoder();

async function makeWs(): Promise<Workspace> {
  const files = new MemFilesApi();
  await files.write("/docs/readme.md", [enc.encode("# Hi")]);
  await files.write("/docs/data.json", [enc.encode("{}")]);
  await files.write("/notes/todo.txt", [enc.encode("x")]);
  const ws = new Workspace();
  ws.setFileSystem(files, "A");
  await ws.open();
  return ws;
}

describe("Workspace.getResource", () => {
  it("resolves an existing resource with a mimeType, cached by path", async () => {
    const ws = await makeWs();
    const r = await ws.getResource("docs/readme.md");
    expect(r).not.toBeNull();
    expect(r?.path.endsWith("docs/readme.md")).toBe(true);
    expect(typeof r?.mimeType).toBe("string");
    expect(r?.mimeType.length).toBeGreaterThan(0);
    expect(await ws.getResource("docs/readme.md")).toBe(r); // LRU identity
  });

  it("returns null for a missing resource without create", async () => {
    const ws = await makeWs();
    expect(await ws.getResource("nope.txt")).toBeNull();
  });

  it("creates a handle for a missing path when create=true", async () => {
    const ws = await makeWs();
    const r = await ws.getResource("new.txt", true);
    expect(r).not.toBeNull();
    expect(r?.path.endsWith("new.txt")).toBe(true);
  });
});

describe("Workspace projects", () => {
  it("lists top-level directories as projects", async () => {
    const ws = await makeWs();
    const names: string[] = [];
    for await (const p of ws.listProjects()) names.push(p.projectName);
    expect(names.sort()).toEqual(["docs", "notes"]);
  });

  it("getProject returns a cached Project that resolves project-relative resources", async () => {
    const ws = await makeWs();
    const p = await ws.getProject("docs");
    expect(p?.projectName).toBe("docs");
    expect(await ws.getProject("docs")).toBe(p); // LRU identity

    const r = await p?.getProjectResource("readme.md");
    expect(r?.path.endsWith("docs/readme.md")).toBe(true);
  });
});
