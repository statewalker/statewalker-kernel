import type { FilesApi as VcsFilesApi } from "@statewalker/vcs-core";
import type { FilesApi } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { type Project, Workspace } from "@statewalker/workspace.core";
import { beforeEach, describe, expect, it } from "vitest";
import { repoFilesOf } from "../../src/runtime/repo-files.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function readText(files: FilesApi, path: string): Promise<string> {
  let text = "";
  for await (const chunk of files.read(path)) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

/** Entry names directly under `path`, sorted — the view's own namespace. */
async function names(files: FilesApi, path: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of files.list(path)) found.push(entry.name);
  return found.sort();
}

describe("repoFilesOf", () => {
  let files: MemFilesApi;
  let workspace: Workspace;

  beforeEach(() => {
    files = new MemFilesApi({
      initialFiles: { "a/README.md": "project a", "b/README.md": "project b" },
    });
    workspace = new Workspace().setFileSystem(files);
  });

  async function projectOf(name: string): Promise<Project> {
    const project = await workspace.getProject(name);
    if (!project) throw new Error(`no project: ${name}`);
    return project;
  }

  it("roots a project's view at its own directory, invisibly to a sibling project", async () => {
    const a = repoFilesOf(await projectOf("a"));
    const b = repoFilesOf(await projectOf("b"));

    await a.write("x.txt", [encoder.encode("from-a")]);

    // The write landed under the project directory of the workspace filesystem —
    // not at its root, and not in the sibling project.
    expect(await files.exists("/a/x.txt")).toBe(true);
    expect(await files.exists("/x.txt")).toBe(false);
    expect(await files.exists("/b/x.txt")).toBe(false);

    // And it is visible only through `a`'s rooted view.
    expect(await a.exists("x.txt")).toBe(true);
    expect(await b.exists("x.txt")).toBe(false);
    expect(await readText(a, "x.txt")).toBe("from-a");
    expect(await names(a, "/")).toEqual(["README.md", "x.txt"]);
    expect(await names(b, "/")).toEqual(["README.md"]);
  });

  it("keeps a sibling's writes out of the other project, symmetrically", async () => {
    const a = repoFilesOf(await projectOf("a"));
    const b = repoFilesOf(await projectOf("b"));

    await b.write("/nested/deep/y.txt", [encoder.encode("from-b")]);

    expect(await files.exists("/b/nested/deep/y.txt")).toBe(true);
    expect(await files.exists("/a/nested/deep/y.txt")).toBe(false);
    expect(await a.exists("/nested/deep/y.txt")).toBe(false);
    expect(await readText(b, "/nested/deep/y.txt")).toBe("from-b");
  });

  it("is memoised per project instance", async () => {
    const project = await projectOf("a");
    expect(repoFilesOf(project)).toBe(repoFilesOf(project));
  });

  it("is assignable to the vcs FilesApi parameter with no cast", async () => {
    // Compile-time conformance: the annotation is the assertion (checked by `tsc`,
    // not by vitest). A cast here would be a D1 conformance finding, not a fix.
    const rooted: VcsFilesApi = repoFilesOf(await projectOf("a"));
    expect(typeof rooted.list).toBe("function");
  });
});
