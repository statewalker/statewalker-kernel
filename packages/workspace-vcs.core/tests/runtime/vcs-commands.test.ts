import type { Git } from "@statewalker/vcs-commands";
import { FileMode } from "@statewalker/vcs-core";
import type { FilesApi } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { type Project, Workspace } from "@statewalker/workspace.core";
import { beforeEach, describe, expect, it } from "vitest";
import { vcsConfigOf } from "../../src/config/index.js";
import { openGitRepo } from "../../src/runtime/git-assembly.js";
import { repoFilesOf } from "../../src/runtime/repo-files.js";
import { registerVcs, type VcsNature, vcsNatureOf } from "../../src/runtime/vcs-nature.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function readText(files: FilesApi, path: string): Promise<string> {
  let text = "";
  for await (const chunk of files.read(path)) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

/** A `fetch` that must never be called — T6 touches no remote. */
const deps = {
  fetch: (() => {
    throw new Error("fetch must not be called by T6");
  }) as never,
};

/**
 * Every **path** in a commit's tree, recursively — `dir/file`, not just `dir`.
 *
 * Recursive on purpose: the trailing-slash exclude bug shows up precisely on nested
 * paths, so a top-level `name` check would pass against the broken pattern.
 */
async function treePaths(git: Git, treeId: string, prefix = ""): Promise<string[]> {
  const history = git.history;
  if (!history) throw new Error("no history on the Git façade");
  const tree = await history.trees.load(treeId);
  if (!tree) throw new Error(`tree not found: ${treeId}`);

  const entries = [];
  for await (const entry of tree) entries.push(entry);

  const paths: string[] = [];
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (((entry.mode as number) & 0o170000) === FileMode.TREE) {
      paths.push(...(await treePaths(git, entry.id, path)));
    } else {
      paths.push(path);
    }
  }
  return paths.sort();
}

/** The tree of the commit `id`, as recursive paths. */
async function committedPaths(git: Git, id: string): Promise<string[]> {
  const history = git.history;
  if (!history) throw new Error("no history on the Git façade");
  const commit = await history.commits.load(id);
  if (!commit) throw new Error(`commit not found: ${id}`);
  return treePaths(git, commit.tree);
}

describe("VcsNature: add / commit / log / status", () => {
  let files: MemFilesApi;
  let workspace: Workspace;

  beforeEach(() => {
    files = new MemFilesApi({
      initialFiles: { "a/README.md": "project a", "b/README.md": "project b" },
    });
    workspace = new Workspace().setFileSystem(files);
    registerVcs(workspace, deps);
  });

  async function projectOf(name: string): Promise<Project> {
    const project = await workspace.getProject(name);
    if (!project) throw new Error(`no project: ${name}`);
    return project;
  }

  /** An initialized nature on project `a`. */
  async function initialized(name = "a"): Promise<VcsNature> {
    const nature = vcsNatureOf(await projectOf(name));
    await nature.init();
    return nature;
  }

  describe("status() is the index against HEAD — never the worktree", () => {
    it("does not see a file that was written but not staged", async () => {
      const nature = await initialized();
      await files.write("/a/notes.md", [encoder.encode("draft")]);

      // The load-bearing assertion of this whole task: `StatusCommand` compares the
      // HEAD tree to the staging index and never reads the worktree, and `Status`
      // has no `untracked` field. A written-but-unstaged file therefore CANNOT
      // appear. (Surfacing untracked files needs `StatusCalculator` with
      // `includeUntracked` — deliberately separate scope.)
      const status = await nature.status();
      expect(status.isClean()).toBe(true);
      expect(status.hasUncommittedChanges()).toBe(false);
      expect([...status.added]).toEqual([]);
    });

    it("reports the file as added once add() has staged it, then as clean after commit()", async () => {
      const nature = await initialized();
      await files.write("/a/notes.md", [encoder.encode("draft")]);

      await nature.add(".");
      const staged = await nature.status();
      expect([...staged.added].sort()).toEqual(["README.md", "notes.md"]);
      expect(staged.isClean()).toBe(false);

      const outcome = await nature.commit({ message: "first" });
      expect(outcome.changed).toBe(true);
      expect(outcome.id).toMatch(/^[0-9a-f]{40}$/);

      // Committed: the index now equals the HEAD tree, so nothing is outstanding.
      const after = await nature.status();
      expect(after.isClean()).toBe(true);

      const log = await nature.log();
      expect(log.map((c) => c.id)).toEqual([outcome.id]);
      expect(log[0]?.message).toBe("first");
      expect(log[0]?.parents).toEqual([]);
      expect(typeof log[0]?.timestamp).toBe("number");
    });

    it("stages only what the pathspec names", async () => {
      const nature = await initialized();
      await files.write("/a/notes.md", [encoder.encode("draft")]);

      await nature.add("notes.md");

      expect([...(await nature.status()).added]).toEqual(["notes.md"]);
    });
  });

  describe("manual commits only — a commit happens inside commit(), or not at all", () => {
    it("commits nothing on a fresh repository with an empty index", async () => {
      const nature = await initialized();

      // The porcelain's empty guard is gated on `parents.length > 0`, so on a repo
      // straight out of init() it would happily create an empty commit. This is the
      // hole the nature closes itself.
      const outcome = await nature.commit({ message: "nothing here" });

      expect(outcome).toEqual({ changed: false });
      expect(await nature.log()).toEqual([]);
      expect(await files.exists("/a/.git/refs/heads/main")).toBe(false);
    });

    it("commits nothing when the staged tree already matches HEAD", async () => {
      const nature = await initialized();
      await nature.add(".");
      const first = await nature.commit({ message: "first" });
      const ref = await readText(files, "/a/.git/refs/heads/main");

      const again = await nature.commit({ message: "same tree" });

      expect(again).toEqual({ changed: false });
      expect((await nature.log()).map((c) => c.id)).toEqual([first.id]);
      expect(await readText(files, "/a/.git/refs/heads/main")).toBe(ref);
    });

    it("still commits when the index is empty but HEAD is not — that is a deletion", async () => {
      const nature = await initialized();
      await nature.add(".");
      const first = await nature.commit({ message: "first" });

      // Unstage everything without touching the worktree: the index is now empty
      // while HEAD holds a tree. "Index is empty" alone therefore does NOT mean
      // "nothing to commit" — it means the whole tree was deleted, which is a real
      // change. This is why the empty pre-check also asks whether HEAD exists.
      const git = await nature.git();
      await git.rm().addFilepattern("README.md").setCached(true).call();
      expect(await git.checkoutState?.staging.getEntryCount()).toBe(0);

      const second = await nature.commit({ message: "delete everything" });

      expect(second.changed).toBe(true);
      expect((await nature.log()).map((c) => c.message)).toEqual(["delete everything", "first"]);
      expect(second.id).not.toBe(first.id);
      if (!second.id) throw new Error("expected a commit id");
      expect(await committedPaths(git, second.id)).toEqual([]);
    });

    it("commits again once the index actually changed", async () => {
      const nature = await initialized();
      await nature.add(".");
      const first = await nature.commit({ message: "first" });

      await files.write("/a/notes.md", [encoder.encode("draft")]);
      await nature.add(".");
      const second = await nature.commit({ message: "second" });

      expect(second.changed).toBe(true);
      expect(second.id).not.toBe(first.id);
      const log = await nature.log();
      expect(log.map((c) => c.message)).toEqual(["second", "first"]);
      expect(log[0]?.parents).toEqual([first.id]);
    });
  });

  describe("log()", () => {
    it("is empty on a repository with no commits rather than throwing", async () => {
      const nature = await initialized();

      // `LogCommand` resolves HEAD and throws `NoHeadError: HEAD cannot be resolved`
      // when no commit exists. "No history yet" is not an error at this level.
      expect(await nature.log()).toEqual([]);
    });

    it("honours max", async () => {
      const nature = await initialized();
      await nature.add(".");
      await nature.commit({ message: "first" });
      await files.write("/a/notes.md", [encoder.encode("draft")]);
      await nature.add(".");
      await nature.commit({ message: "second" });

      expect((await nature.log({ max: 1 })).map((c) => c.message)).toEqual(["second"]);
    });
  });

  describe("the commit author", () => {
    it("comes from nature.vcs.json when the project declares one", async () => {
      const nature = vcsNatureOf(await projectOf("a"));
      await nature.init({ author: { name: "Ada", email: "ada@example.com" } });
      await nature.add(".");
      await nature.commit({ message: "first" });

      expect((await nature.log())[0]?.author).toEqual({ name: "Ada", email: "ada@example.com" });
    });

    it("is overridden per call when commit() is given one", async () => {
      const nature = vcsNatureOf(await projectOf("a"));
      await nature.init({ author: { name: "Ada", email: "ada@example.com" } });
      await nature.add(".");
      await nature.commit({
        message: "first",
        author: { name: "Grace", email: "grace@example.com" },
      });

      expect((await nature.log())[0]?.author).toEqual({
        name: "Grace",
        email: "grace@example.com",
      });
    });
  });

  describe(".project never reaches git", () => {
    it("stays out of both the index and the committed tree, at every depth", async () => {
      const nature = await initialized();
      // `.project/` already holds `nature.vcs.json`; a nested file is what the
      // trailing-slash form of the exclude pattern would let through.
      await files.write("/a/.project/state/scan.lock", [encoder.encode("x")]);
      await files.write("/a/src/main.ts", [encoder.encode("export {};")]);

      await nature.add(".");
      const staged = await nature.status();
      expect([...staged.added].filter((p) => p.split("/")[0] === ".project")).toEqual([]);
      expect([...staged.added].sort()).toEqual(["README.md", "src/main.ts"]);

      const outcome = await nature.commit({ message: "all" });
      expect(outcome.changed).toBe(true);
      if (!outcome.id) throw new Error("expected a commit id");

      const paths = await committedPaths(await nature.git(), outcome.id);
      expect(paths).toEqual(["README.md", "src/main.ts"]);
      expect(paths.filter((p) => p.startsWith(".project"))).toEqual([]);
      expect(paths.filter((p) => p.startsWith(".git"))).toEqual([]);
      // And the marker really is on disk — the commit excluded it, it is not missing.
      expect(await vcsConfigOf(await projectOf("a")).exists()).toBe(true);
    });

    it("stays out even when the repository was never created through init()", async () => {
      const project = await projectOf("a");
      // What a repository made by **native `git init`** — or one predating GitNature —
      // looks like to us: a real `.git` on disk that never passed through
      // `VcsNature.init()`, so nothing on that path wrote `.git/info/exclude`. We
      // advertise native-git compatibility (T12), so this is a state users will
      // genuinely hand us, and committing `.project/**` into their history is not
      // recoverable by a later fix.
      await openGitRepo(repoFilesOf(project), { create: true });
      await files.write("/a/.project/nature.vcs.json", [encoder.encode('{"version":1}')]);
      await files.write("/a/.project/state/scan.lock", [encoder.encode("x")]);

      const nature = vcsNatureOf(project);
      expect(await nature.exists()).toBe(true);

      await nature.add(".");
      const staged = await nature.status();
      expect([...staged.added].filter((p) => p.split("/")[0] === ".project")).toEqual([]);

      const outcome = await nature.commit({
        message: "all",
        author: { name: "Test", email: "test@example.com" },
      });
      expect(outcome.changed).toBe(true);
      if (!outcome.id) throw new Error("expected a commit id");

      // Recursively — the trailing-slash class of bug only leaks on nested paths.
      const paths = await committedPaths(await nature.git(), outcome.id);
      expect(paths).toEqual(["README.md"]);
      expect(paths.filter((p) => p.startsWith(".project"))).toEqual([]);
    });
  });

  describe("two projects", () => {
    it("commit into their own histories", async () => {
      const a = await initialized("a");
      const b = await initialized("b");

      await a.add(".");
      const first = await a.commit({ message: "a only" });

      expect(await b.log()).toEqual([]);
      expect((await b.status()).isClean()).toBe(true);

      await b.add(".");
      const second = await b.commit({ message: "b only" });

      expect(second.id).not.toBe(first.id);
      expect((await a.log()).map((c) => c.message)).toEqual(["a only"]);
      expect((await b.log()).map((c) => c.message)).toEqual(["b only"]);
    });
  });
});
