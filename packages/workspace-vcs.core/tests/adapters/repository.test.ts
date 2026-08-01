import type { Git } from "@statewalker/vcs-commands";
import { manifestOf, type Repository } from "@statewalker/vcs-workspace";
import type { FilesApi } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { type Project, Workspace } from "@statewalker/workspace.core";
import { beforeEach, describe, expect, it } from "vitest";
import { createGitRepository, trackedFilesOf } from "../../src/adapters/repository.js";
import { repoFilesOf } from "../../src/runtime/repo-files.js";
import { registerVcs, type VcsNature, vcsNatureOf } from "../../src/runtime/vcs-nature.js";
import { hashContentSha256 } from "../../src/util/hash-content.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A `fetch` that must never be called — T8 touches no remote. */
const deps = {
  fetch: (() => {
    throw new Error("fetch must not be called by T8");
  }) as never,
};

async function readText(files: FilesApi, path: string): Promise<string> {
  let text = "";
  for await (const chunk of files.read(path)) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

async function* one(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

describe("createGitRepository — the vcs-workspace Repository adapter", () => {
  let files: MemFilesApi;
  let workspace: Workspace;

  beforeEach(() => {
    files = new MemFilesApi({
      initialFiles: {
        "a/README.md": "hello",
        "a/src/deep/nested.txt": "nested",
        // A project whose entire content is workbench state: `.project` is excluded
        // from git, so as far as the repository is concerned this worktree is EMPTY.
        "empty/.project/keep.txt": "workbench state",
      },
    });
    workspace = new Workspace().setFileSystem(files);
    registerVcs(workspace, deps);
  });

  async function projectOf(name: string): Promise<Project> {
    const project = await workspace.getProject(name);
    if (!project) throw new Error(`no project: ${name}`);
    return project;
  }

  /** An initialized nature plus the `Repository` adapter over it. */
  async function repositoryOf(name = "a"): Promise<{
    nature: VcsNature;
    project: Project;
    repository: Repository;
  }> {
    const project = await projectOf(name);
    const nature = vcsNatureOf(project);
    await nature.init();
    const repository = createGitRepository(
      await nature.git(),
      repoFilesOf(project),
      hashContentSha256,
    );
    return { nature, project, repository };
  }

  describe("hashContentSha256", () => {
    it("is lowercase hex SHA-256 of the concatenated chunks", async () => {
      // The published vector for "abc".
      expect(await hashContentSha256(one(encoder.encode("abc")))).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
      // …and for the empty stream.
      expect(
        await hashContentSha256(
          (async function* () {
            // no chunks
          })(),
        ),
      ).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    });

    it("does not depend on how the stream is chunked", async () => {
      async function* split(): AsyncIterable<Uint8Array> {
        yield encoder.encode("a");
        yield encoder.encode("bc");
      }
      expect(await hashContentSha256(split())).toBe(
        await hashContentSha256(one(encoder.encode("abc"))),
      );
    });
  });

  describe("manifest() — the file-state identity, and `.git` is not part of it", () => {
    it("does not move when a commit is created", async () => {
      const { nature, repository } = await repositoryOf();

      const before = await repository.manifest();
      await nature.add(".");
      const outcome = await nature.commit({ message: "first" });
      expect(outcome.changed).toBe(true);

      // `manifestOf` → `buildAnchor` lists recursively and hashes EVERYTHING it
      // sees. Handed the raw project view it would fold `.git/index`, `.git/HEAD`
      // and `.git/objects/**` into the id — so committing (or merely staging)
      // would move the "working tree" manifest, and a checkpoint could never be
      // re-derived from the files alone. The adapter measures a `.git`-excluding
      // view, which is what makes this equality hold.
      expect(await repository.manifest()).toBe(before);
    });

    it("moves when a NESTED file changes", async () => {
      const { repository } = await repositoryOf();

      const before = await repository.manifest();
      await files.write("/a/src/deep/nested.txt", [encoder.encode("changed")]);

      // `buildAnchor` passes `{recursive: true}` to `FilesApi.list`, so the manifest
      // must fold in nested files; a wrapper that dropped the argument would flatten
      // it to root level and this edit would be invisible.
      //
      // NOT a test of D1, and an earlier comment here said otherwise. The `FilesApi`
      // on the `manifestOf` → `buildAnchor` path is **webrun's**
      // (`files-sync/src/types.ts` imports it from `@statewalker/webrun-files`), not
      // vcs's, so D1's widening of the *vcs* declaration never appears here. Nor
      // could a TypeScript declaration have "silently dropped" a runtime argument:
      // every implementation always honoured `recursive`, and pre-D1 the mismatch
      // was a compile error at most. What this pins is `FilteredFilesApi` forwarding
      // `ListOptions` — see `trackedFilesOf`.
      expect(await repository.manifest()).not.toBe(before);
    });

    it("moves when a root-level file changes", async () => {
      const { repository } = await repositoryOf();

      const before = await repository.manifest();
      await files.write("/a/README.md", [encoder.encode("goodbye")]);

      expect(await repository.manifest()).not.toBe(before);
    });

    it("equals manifestOf over trackedFilesOf(files) — the view T10 must publish", async () => {
      const { project, repository } = await repositoryOf();

      // `publish` computes its checkpoint manifest as `manifestOf(ws.workingTree,
      // hashContent)` — it never calls `repository.manifest()`. The two agree only
      // when the caller hands it THIS view and THIS hash function.
      expect(await repository.manifest()).toBe(
        await manifestOf(trackedFilesOf(repoFilesOf(project)), hashContentSha256),
      );
    });

    it("hides .git from the tracked view entirely", async () => {
      const { project } = await repositoryOf();
      const tracked = trackedFilesOf(repoFilesOf(project));

      expect(await tracked.exists(".git/HEAD")).toBe(false);
      const paths: string[] = [];
      for await (const info of tracked.list("/", { recursive: true })) paths.push(info.path);
      expect(paths.filter((p) => p.split("/").includes(".git"))).toEqual([]);
      expect(paths).toContain("/README.md");
      expect(paths).toContain("/src/deep/nested.txt");
    });

    it("hides a NESTED .git too, so a vendored repository cannot move the manifest", async () => {
      const { project, repository } = await repositoryOf();
      await files.write("/a/vendor/lib/.git/HEAD", [encoder.encode("ref: refs/heads/main\n")]);
      await files.write("/a/vendor/lib/README.md", [encoder.encode("vendored")]);

      const before = await repository.manifest();
      // One byte inside the nested repository's object store. Nothing about the
      // project's own files changed, so the checkpoint id must not move — that is
      // exactly the "re-derivable from the files alone" property the filter exists
      // for, and a prefix-anchored `/.git` only ever protected the ROOT one.
      await files.write("/a/vendor/lib/.git/objects/ab/cdef", [encoder.encode("x")]);

      expect(await repository.manifest()).toBe(before);

      const tracked = trackedFilesOf(repoFilesOf(project));
      const paths: string[] = [];
      for await (const info of tracked.list("/", { recursive: true })) paths.push(info.path);
      expect(paths.filter((p) => p.split("/").includes(".git"))).toEqual([]);
      // The nested repository's own working files are still the project's files.
      expect(paths).toContain("/vendor/lib/README.md");
    });

    it("hides .project, so workbench state cannot move the manifest either", async () => {
      const { project, repository } = await repositoryOf();

      const before = await repository.manifest();
      // A background write under `.project` — the scanner's index, transaction
      // state, this nature's own marker. HEAD does not move, so `publish` would
      // pair a NEW manifest with the OLD commit, and no commit could ever match it.
      await files.write("/a/.project/state/scan.lock", [encoder.encode("x")]);

      expect(await repository.manifest()).toBe(before);

      const tracked = trackedFilesOf(repoFilesOf(project));
      const paths: string[] = [];
      for await (const info of tracked.list("/", { recursive: true })) paths.push(info.path);
      expect(paths.filter((p) => p.split("/").includes(".project"))).toEqual([]);
      // And nothing under `.project` — `nature.vcs.json` included — is mirrored to
      // a file remote, which is what the same view feeds.
      expect(await tracked.exists(".project/nature.vcs.json")).toBe(false);
    });
  });

  describe("head()", () => {
    it("is undefined on an empty history", async () => {
      const { repository } = await repositoryOf();

      expect(await repository.head()).toBeUndefined();
    });

    it("is the commit HEAD resolves to", async () => {
      const { nature, repository } = await repositoryOf();
      await nature.add(".");
      const outcome = await nature.commit({ message: "first" });

      expect(await repository.head()).toBe(outcome.id);
      expect(await repository.head()).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  describe("hasChanges() — the WORKING TREE, not the index", () => {
    it("is true after an UNSTAGED edit", async () => {
      const { nature, repository } = await repositoryOf();
      await nature.add(".");
      await nature.commit({ message: "first" });

      await files.write("/a/README.md", [encoder.encode("edited")]);

      // The load-bearing assertion of this task. Two ways to get this wrong, both
      // silent: `StatusCommand` is staged-only and reports the index clean here,
      // and `git.workingCopy.getStatus()` is a MemoryWorkingCopy stub whose
      // `isClean: true` is a hardcoded literal. Either would return `false`, and
      // under `commitOnlyWhenChanged` `publish` would skip a needed commit.
      expect(await nature.status().then((s) => s.isClean())).toBe(true);
      expect(await repository.hasChanges()).toBe(true);
    });

    it("is false on a freshly committed, clean tree", async () => {
      const { nature, repository } = await repositoryOf();
      await nature.add(".");
      await nature.commit({ message: "first" });

      // The other direction, and it is not free: `StatusCalculatorImpl` answers
      // `hasUnstaged: true` here, because its size+mtime heuristic treats a file
      // whose mtime is younger than the index as "racily clean ⇒ maybe modified".
      // A `hasChanges()` built on it would be permanently true and
      // `commitOnlyWhenChanged` would never skip anything.
      expect(await repository.hasChanges()).toBe(false);
    });

    it("is true for a new untracked file", async () => {
      const { nature, repository } = await repositoryOf();
      await nature.add(".");
      await nature.commit({ message: "first" });

      await files.write("/a/notes.md", [encoder.encode("draft")]);

      expect(await repository.hasChanges()).toBe(true);
    });

    it("is true when a tracked file is deleted from the worktree", async () => {
      const { nature, repository } = await repositoryOf();
      await nature.add(".");
      await nature.commit({ message: "first" });

      expect(await files.remove("/a/src/deep/nested.txt")).toBe(true);

      expect(await repository.hasChanges()).toBe(true);
    });

    it("is true when a change is staged but not yet committed", async () => {
      const { nature, repository } = await repositoryOf();
      await nature.add(".");
      await nature.commit({ message: "first" });

      await files.write("/a/notes.md", [encoder.encode("draft")]);
      await nature.add(".");

      // Worktree and index now agree; the index and HEAD do not. Still uncommitted.
      expect(await repository.hasChanges()).toBe(true);
    });

    it("is true on a fresh repository whose worktree has files", async () => {
      const { repository } = await repositoryOf();

      expect(await repository.hasChanges()).toBe(true);
    });

    it("ignores .project — the workbench's own state is not the project's source", async () => {
      const { nature, repository } = await repositoryOf();
      await nature.add(".");
      await nature.commit({ message: "first" });

      await files.write("/a/.project/state/scan.lock", [encoder.encode("x")]);

      // `.project` is in `.git/info/exclude`, so `commit()` would stage nothing
      // from it — reporting a change here would make `publish` commit forever.
      expect(await repository.hasChanges()).toBe(false);
    });

    it("converges on a worktree that grows a NESTED .git after the commit", async () => {
      // The worktree walk prunes any directory holding a `.git`, and `add(".")`
      // walks the same way — so once `vendor/lib` becomes a repository, the index
      // entries beneath it are unreachable: no commit can ever change them.
      // Counting them as changes made `hasChanges()` permanently true while
      // `commit()` reported `{changed: false}`, and `commitOnlyWhenChanged` then
      // committed on every publish, forever.
      const { nature, repository } = await repositoryOf();
      await files.write("/a/vendor/lib/README.md", [encoder.encode("vendored")]);
      await nature.add(".");
      await nature.commit({ message: "first" });
      expect(await repository.hasChanges()).toBe(false);

      await files.write("/a/vendor/lib/.git/HEAD", [encoder.encode("ref: refs/heads/main\n")]);

      expect(await repository.hasChanges()).toBe(false);
      // And the pair really does converge: a commit attempt changes nothing.
      expect((await repository.commit({})).changed).toBe(false);
      expect(await repository.hasChanges()).toBe(false);
    });
  });

  describe("commit()", () => {
    it("stages the worktree itself and returns the new commit", async () => {
      const { nature, repository } = await repositoryOf();

      // Nothing was staged by this test: `CommitCommand` reads the index, so an
      // adapter that did not `add` first would commit an empty tree.
      const result = await repository.commit({ message: "first" });

      expect(result.changed).toBe(true);
      expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(await repository.head()).toBe(result.commit);
      expect((await nature.log()).map((c) => c.message)).toEqual(["first"]);
    });

    it("picks up an unstaged edit made after the previous commit", async () => {
      const { repository } = await repositoryOf();
      const first = await repository.commit({ message: "first" });

      await files.write("/a/README.md", [encoder.encode("edited")]);
      const second = await repository.commit({ message: "second" });

      expect(second.changed).toBe(true);
      expect(second.commit).not.toBe(first.commit);
    });

    it("returns {commit: head, changed: false} when there is nothing to commit", async () => {
      const { repository } = await repositoryOf();
      const first = await repository.commit({ message: "first" });

      // `CommitCommand` raises `EmptyCommitError` and `CommitResult` carries no
      // `changed` field, while `Repository.commit` must return a NON-OPTIONAL
      // commit id. So the id has to come from HEAD.
      const again = await repository.commit({ message: "same tree" });

      expect(again).toEqual({ commit: first.commit, changed: false });
    });

    it("commits without a message — the field is optional on Repository", async () => {
      const { nature, repository } = await repositoryOf();

      // `CommitCommand` throws `NoMessageError` on an absent message; the adapter
      // must supply a default rather than propagate that.
      const result = await repository.commit({});

      expect(result.changed).toBe(true);
      expect((await nature.log())[0]?.message).toBeTruthy();
    });

    it("throws on an empty history with a clean tree — no id could satisfy the type", async () => {
      const { repository } = await repositoryOf("empty");

      // The one case `{commit: string; changed: boolean}` cannot express: nothing
      // to commit AND no commit exists to name. `CommitCommand`'s empty guard is
      // gated on `parents.length > 0`, so left alone it would happily write an
      // empty root commit and hand back an id for a state that has none.
      await expect(repository.commit({ message: "nothing" })).rejects.toThrow(/nothing to commit/i);
      expect(await repository.head()).toBeUndefined();
    });
  });

  describe("commit() error discrimination", () => {
    /** The same `Git`, with `commit()` replaced by a builder that throws `error`. */
    function gitWhoseCommitThrows(git: Git, error: unknown): Git {
      const builder = {
        setMessage() {
          return builder;
        },
        setAuthor() {
          return builder;
        },
        call() {
          return Promise.reject(error);
        },
      };
      return new Proxy(git, {
        get(target, prop, receiver) {
          if (prop === "commit") return () => builder;
          const value = Reflect.get(target, prop, receiver) as unknown;
          return typeof value === "function" ? (value as CallableFunction).bind(target) : value;
        },
      }) as Git;
    }

    it("treats a FOREIGN EmptyCommitError as 'nothing to commit'", async () => {
      // Nine `@statewalker/vcs-*` packages resolve to `dist/` while others resolve
      // to `src/`, so two copies of `vcs-commands` can be live at once and the error
      // a command throws need not be the class this package imported. `instanceof`
      // alone would call this a hard failure.
      const { nature, project } = await repositoryOf();
      await nature.add(".");
      const head = await nature.commit({ message: "first" });

      const foreign = Object.assign(new Error("nothing to commit"), {
        name: "EmptyCommitError",
      });
      const repository = createGitRepository(
        gitWhoseCommitThrows(await nature.git(), foreign),
        repoFilesOf(project),
        hashContentSha256,
      );

      expect(await repository.commit({})).toEqual({ commit: head.id, changed: false });
    });

    it("rethrows anything that is not 'nothing to commit'", async () => {
      const { nature, project } = await repositoryOf();
      await nature.add(".");
      await nature.commit({ message: "first" });

      const repository = createGitRepository(
        gitWhoseCommitThrows(await nature.git(), new Error("ENOSPC: no space left on device")),
        repoFilesOf(project),
        hashContentSha256,
      );

      await expect(repository.commit({})).rejects.toThrow(/ENOSPC/);
    });
  });

  describe("checkout()", () => {
    it("restores the worktree to a commit", async () => {
      const { repository } = await repositoryOf();
      const first = await repository.commit({ message: "first" });

      await files.write("/a/README.md", [encoder.encode("second version")]);
      await repository.commit({ message: "second" });
      expect(await readText(files, "/a/README.md")).toBe("second version");

      await repository.checkout(first.commit);

      expect(await readText(files, "/a/README.md")).toBe("hello");
      expect(await repository.head()).toBe(first.commit);
    });

    it("throws rather than silently no-op when the index is dirty", async () => {
      const { nature, repository } = await repositoryOf();
      const first = await repository.commit({ message: "first" });

      await files.write("/a/README.md", [encoder.encode("uncommitted")]);
      await nature.add(".");

      // `checkoutBranch` RETURNS `{status: CONFLICTS}` — it does not throw — and
      // `Repository.checkout` returns `void`. Without inspecting the status the
      // failure is invisible to every caller, and `restore` would report success
      // over a working tree that was never restored.
      await expect(repository.checkout(first.commit)).rejects.toThrow(/CONFLICTS/);
      expect(await readText(files, "/a/README.md")).toBe("uncommitted");
    });
  });
});
