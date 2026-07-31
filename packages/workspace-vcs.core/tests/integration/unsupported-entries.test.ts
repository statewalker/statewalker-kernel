/**
 * Symlinks, gitlinks and executables — **refused loudly, never corrupted**.
 *
 * The root cause is one line upstream and out of this contract's bounds:
 * `FileWorktree.getFileMode` (`vcs/packages/store-files`) returns
 * `FileMode.REGULAR_FILE` for **every** path, unconditionally. Two consequences
 * follow, both measured against real git before this suite existed:
 *
 * - **The exec bit is silently stripped.** `AddCommand` stages
 *   `worktreeEntry.mode`, so `add(".")` over an adopted repository rewrites every
 *   `100755` index entry to `100644`. `git fsck` does not flag it, and
 *   `hasChanges()` cannot see it either — that comparison is content-only.
 * - **A symlink is replaced by its target's content.** `Worktree.computeHash`
 *   follows the link and hashes what it points at, which can never equal the
 *   `120000` blob — so `hasChanges()` answers `true` on a repository real git
 *   calls clean, and `commitOnlyWhenChanged` therefore commits. Measured on an
 *   adopted repository: `link.txt` went from `120000 blob 4cbb553f…` (the link
 *   target) to `100644 blob 1debab1e…` — byte-identical to `target.txt`. The
 *   spurious `true` then stops, because the link is gone from history; the loop
 *   terminates by destroying the thing it kept noticing. That is irreversible.
 *
 * The ratified response is **refusal, not repair**: fixing `getFileMode` means
 * editing `store-files`, which is hard-banned here, and a silent degradation is
 * worse than an error. So every entry point that would stage or measure such a
 * repository raises `UnsupportedEntryError` instead, and the repository is left
 * exactly as it was found.
 *
 * **Detection is index-based, and that is a real limit.** The index is the only
 * place a true mode survives — a native `git add` wrote `120000` / `100755` there,
 * and the worktree view cannot report one. An *untracked* symlink or executable is
 * therefore invisible to these guards; see the `## Known limits` section of
 * `CONTEXT.md`.
 *
 * Every repository here is built by **real git**, because our own writer cannot
 * produce the modes under test.
 */

import { lstatSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeFilesApi } from "@statewalker/vcs-utils-node";
import type { Repository } from "@statewalker/vcs-workspace";
import type { FilesApi } from "@statewalker/webrun-files";
import { type Project, Workspace } from "@statewalker/workspace.core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGitRepository, UnsupportedEntryError } from "../../src/adapters/index.js";
import { repoFilesOf } from "../../src/runtime/repo-files.js";
import { registerVcs, type VcsNature, vcsNatureOf } from "../../src/runtime/vcs-nature.js";
import { hashContentSha256 } from "../../src/util/hash-content.js";
import { detectNativeGit, nativeGitIn } from "../helpers/native-git-client.js";

const PROJECT = "demo";

/** A `fetch` that must never be called: this suite is entirely local. */
const deps = {
  fetch: (() => {
    throw new Error("unsupported-entry tests must not reach the network");
  }) as never,
};

const git = detectNativeGit();

if (!git.available) {
  console.warn(
    `[F3/F4 unsupported entries] SKIPPED — ${git.reason}. ` +
      "The symlink and exec-bit refusals are UNVERIFIED in this run.",
  );
}

describe.skipIf(!git.available)("repositories holding a mode this nature cannot carry", () => {
  let root: string;
  let projectDir: string;
  let files: FilesApi;
  let nature: VcsNature;
  let project: Project;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "gitnature-modes-"));
    projectDir = join(root, PROJECT);
    await mkdir(projectDir, { recursive: true });

    files = createNodeFilesApi({ rootDir: root }) as unknown as FilesApi;
    const workspace = new Workspace().setFileSystem(files, "modes");
    registerVcs(workspace, deps);
    const found: Project | null = await workspace.getProject(PROJECT);
    if (!found) throw new Error(`no project: ${PROJECT}`);
    project = found;
    nature = vcsNatureOf(project);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  /** `git init` + one commit of whatever `seed` put on disk — real git, real modes. */
  async function nativeRepo(seed: () => void): Promise<void> {
    const nativeGit = nativeGitIn(projectDir);
    await nativeGit.ok("init", "--initial-branch=main");
    seed();
    await nativeGit.ok("add", "-A");
    await nativeGit.ok(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@statewalker.test",
      "commit",
      "-m",
      "adopted",
    );
  }

  /** The `Repository` adapter over the adopted repository. */
  async function repository(): Promise<Repository> {
    return createGitRepository(await nature.git(), repoFilesOf(project), hashContentSha256);
  }

  /** `path` -> mode, as `git ls-tree` reports it for the current HEAD. */
  async function treeModes(): Promise<Record<string, string>> {
    const out = await nativeGitIn(projectDir).ok("ls-tree", "-r", "HEAD");
    const modes: Record<string, string> = {};
    for (const line of out.split("\n")) {
      const match = /^(\d{6}) \w+ [0-9a-f]+\t(.+)$/.exec(line);
      if (match?.[1] && match[2]) modes[match[2]] = match[1];
    }
    return modes;
  }

  describe("a symlink", () => {
    beforeEach(async () => {
      await nativeRepo(() => {
        writeFileSync(join(projectDir, "target.txt"), "the real content\n");
        symlinkSync("target.txt", join(projectDir, "link.txt"));
      });
      // The fixture is what it claims to be, before anything of ours runs.
      expect(await treeModes()).toEqual({ "link.txt": "120000", "target.txt": "100644" });
    });

    it("hasChanges() refuses instead of answering 'changed' forever", async () => {
      const repo = await repository();

      // Without the guard this returns `true` on a repository real git calls clean
      // (`git status --porcelain` is empty) — `computeHash` hashes "the real
      // content", never the 120000 blob — so `commitOnlyWhenChanged` commits, and
      // that commit is the one that destroys the link.
      await expect(repo.hasChanges()).rejects.toThrow(UnsupportedEntryError);
      await expect(repo.hasChanges()).rejects.toThrow(/link\.txt/);
    });

    it("commit() refuses, and the symlink is still a symlink afterwards", async () => {
      const repo = await repository();

      await expect(repo.commit({ message: "checkpoint" })).rejects.toThrow(UnsupportedEntryError);

      // The irreversible half: an unguarded commit records a REGULAR file holding
      // the target's bytes, and `git checkout` then materialises it as one.
      expect(lstatSync(join(projectDir, "link.txt")).isSymbolicLink()).toBe(true);
      expect(await treeModes()).toEqual({ "link.txt": "120000", "target.txt": "100644" });
      expect(await nativeGitIn(projectDir).ok("status", "--porcelain")).toBe("");
    });

    it("nature.add() refuses before staging anything", async () => {
      await expect(nature.add(".")).rejects.toThrow(UnsupportedEntryError);
      expect(await nativeGitIn(projectDir).ok("status", "--porcelain")).toBe("");
    });

    it("nature.commit() refuses too", async () => {
      writeFileSync(join(projectDir, "extra.txt"), "more\n");
      await expect(nature.commit({ message: "checkpoint" })).rejects.toThrow(UnsupportedEntryError);
      expect(await treeModes()).toEqual({ "link.txt": "120000", "target.txt": "100644" });
    });
  });

  describe("an executable file", () => {
    beforeEach(async () => {
      await nativeRepo(() => {
        writeFileSync(join(projectDir, "run.sh"), "#!/bin/sh\necho hi\n", { mode: 0o755 });
        writeFileSync(join(projectDir, "README.md"), "# demo\n");
      });
      expect(await treeModes()).toEqual({ "run.sh": "100755", "README.md": "100644" });
    });

    it("nature.add() refuses rather than rewriting 100755 to 100644", async () => {
      // `add(".")` stages `worktreeEntry.mode`, which `getFileMode` reports as
      // REGULAR_FILE for everything — so without the guard the exec bit is gone
      // from the index, and the next commit records it gone from history too.
      await expect(nature.add(".")).rejects.toThrow(UnsupportedEntryError);
      await expect(nature.add(".")).rejects.toThrow(/run\.sh/);

      expect(await nativeGitIn(projectDir).ok("status", "--porcelain")).toBe("");
      expect(await treeModes()).toEqual({ "run.sh": "100755", "README.md": "100644" });
    });

    it("commit() through the Repository adapter refuses, and ls-tree still says 100755", async () => {
      const repo = await repository();

      await expect(repo.commit({ message: "checkpoint" })).rejects.toThrow(UnsupportedEntryError);

      expect(await treeModes()).toEqual({ "run.sh": "100755", "README.md": "100644" });
    });

    it("hasChanges() refuses — a content-only comparison cannot see the mode at all", async () => {
      const repo = await repository();
      await expect(repo.hasChanges()).rejects.toThrow(UnsupportedEntryError);
    });

    it("names the path and the mode it found", async () => {
      const error = await nature.add(".").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnsupportedEntryError);
      const unsupported = error as UnsupportedEntryError;
      expect(unsupported.path).toBe("run.sh");
      expect(unsupported.mode).toBe(0o100755);
      expect(unsupported.message).toContain("100755");
    });
  });

  describe("a repository this nature can carry", () => {
    it("is untouched by the guard — plain files still add, commit and compare", async () => {
      await nativeRepo(() => {
        writeFileSync(join(projectDir, "README.md"), "# demo\n");
      });

      const repo = await repository();
      expect(await repo.hasChanges()).toBe(false);

      writeFileSync(join(projectDir, "CHANGELOG.md"), "- first\n");
      expect(await repo.hasChanges()).toBe(true);

      const outcome = await repo.commit({ message: "checkpoint" });
      expect(outcome.changed).toBe(true);
      expect(await treeModes()).toEqual({ "README.md": "100644", "CHANGELOG.md": "100644" });
    });
  });
});
