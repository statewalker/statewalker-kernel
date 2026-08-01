import type { FilesApi } from "@statewalker/vcs-core";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { openGitRepo } from "../../src/runtime/git-assembly.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function readText(files: FilesApi, path: string): Promise<string> {
  let text = "";
  for await (const chunk of files.read(path)) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

/** Every file path under `path`, recursively — this is what "on disk" means here. */
async function filePaths(files: MemFilesApi, path: string): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of files.list(path, { recursive: true })) {
    if (entry.kind === "file") found.push(entry.path);
  }
  return found.sort();
}

/** The loose-object paths a real git would find: `.git/objects/XX/XXXX…`, packs excluded. */
async function looseObjects(files: MemFilesApi): Promise<string[]> {
  return (await filePaths(files, "/.git/objects")).filter(
    (p) => !p.startsWith("/.git/objects/pack/"),
  );
}

describe("openGitRepo", () => {
  let files: MemFilesApi;

  beforeEach(() => {
    files = new MemFilesApi();
  });

  /** Stage `a.txt` and commit it. Returns the commit id. */
  async function commitOneFile(name: string, body: string, message: string): Promise<string> {
    const git = await openGitRepo(files, { create: !(await files.exists("/.git/HEAD")) });
    await files.write(name, [encoder.encode(body)]);
    await git.add().addFilepattern(name).call();
    const commit = await git
      .commit()
      .setMessage(message)
      .setAuthor("Test", "test@example.com")
      .call();
    return commit.id;
  }

  it("writes a real .git — HEAD, refs and loose objects — not an in-memory history", async () => {
    const id = await commitOneFile("a.txt", "hello", "first");

    // The three things that make this a repository native git can read. `.git/index`
    // is deliberately NOT the assertion: FileStagingStore writes it with no repository
    // behind it, so it would prove nothing.
    expect(await files.exists("/.git/HEAD")).toBe(true);
    expect(await readText(files, "/.git/HEAD")).toBe("ref: refs/heads/main\n");
    expect(await files.exists("/.git/refs/heads/main")).toBe(true);
    expect((await readText(files, "/.git/refs/heads/main")).trim()).toBe(id);

    // The commit itself is a loose object at `.git/objects/<2>/<38>` — and so are the
    // tree and the blob it points at, so a commit of one file is three objects.
    const objects = await looseObjects(files);
    expect(objects).toContain(`/.git/objects/${id.slice(0, 2)}/${id.slice(2)}`);
    expect(objects.length).toBe(3);
    for (const path of objects) {
      expect(path).toMatch(/^\/\.git\/objects\/[0-9a-f]{2}\/[0-9a-f]{38}$/);
    }
  });

  it("survives a full teardown: a rebuilt Git reads the commit back from the FilesApi", async () => {
    const id = await commitOneFile("a.txt", "hello", "first");

    // Full teardown: every object built above is unreachable — the backend, the
    // history, the staging store, the worktree, the Git façade. The only thing that
    // crosses into the next line is `files`. Anything less than this passes against
    // an in-memory history and is worthless.
    const reopened = await openGitRepo(files, { create: false });
    const log = [];
    for await (const commit of await reopened.log().call()) log.push(commit);

    expect(log.length).toBe(1);
    expect(log[0]?.id).toBe(id);
    expect(log[0]?.message).toBe("first");
  });

  it("opens an existing repository instead of clobbering it (create: false)", async () => {
    const first = await commitOneFile("a.txt", "hello", "first");
    const second = await commitOneFile("b.txt", "world", "second");

    const reopened = await openGitRepo(files, { create: false });
    const log = [];
    for await (const commit of await reopened.log().call()) log.push(commit);

    expect(log.map((c) => c.id)).toEqual([second, first]);
    expect((await readText(files, "/.git/refs/heads/main")).trim()).toBe(second);
  });

  it("keeps two repositories on two FilesApis wholly independent", async () => {
    const other = new MemFilesApi();
    await commitOneFile("a.txt", "hello", "first");

    const git = await openGitRepo(other, { create: true });
    await other.write("only-here.txt", [encoder.encode("x")]);
    await git.add().addFilepattern("only-here.txt").call();
    await git.commit().setMessage("other").setAuthor("Test", "test@example.com").call();

    expect(await files.exists("/only-here.txt")).toBe(false);
    expect(await other.exists("/a.txt")).toBe(false);
    expect(await readText(files, "/.git/refs/heads/main")).not.toBe(
      await readText(other, "/.git/refs/heads/main"),
    );
  });
});
