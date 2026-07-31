/**
 * Native-git conformance — the feature's headline claim, checked by git itself.
 *
 * "A real `.git` per project, readable by native git" is what this whole nature is built around,
 * and every other suite verifies it with **our own** reader: `.git/config` written by our writer
 * and parsed by our parser, a commit written by our object store and read back through our
 * `History`. Those prove round-tripping, not compatibility. This suite is the only place where a
 * process that shares no code with us is asked what it sees.
 *
 * Three things make it different from every other test here, and each is load-bearing:
 *
 * 1. **A Node-backed `FilesApi`, in a real temp directory.** `MemFilesApi` is unreadable by a
 *    subprocess; nothing below could run over it.
 * 2. **The repository is built through `VcsNature`** — `init` → write → `add(".")` → `commit` —
 *    not through `openGitRepo`. The claim being tested is about the product's own path, and the
 *    `.git/info/exclude` that hides `.project` is written by `init()` alone.
 * 3. **Assertions read real `git` output**, not ours. `git fsck` decides whether the object graph
 *    is well-formed; `git log`/`git status --porcelain` decide what the repository contains.
 *
 * **`.project` is the sharpest of these** — and the one whose obvious assertion is vacuous.
 * `vcs-commands.test.ts` already asserts our `status()` omits it, but our reader honours the
 * exclude file *we* wrote, so that test cannot distinguish "excluded" from "our reader agrees with
 * our writer". Real git resolving `.git/info/exclude` on its own is what turns it into a fact —
 * **via `ls-tree`, not `status --porcelain`**, for the measured reason recorded on that suite
 * below. Note the scope: `init()` writes that exclude, so this holds for repositories this nature
 * created — a `.git` made by native `git init` and adopted later has no such file, which is a
 * known, separate gap.
 *
 * **Skip discipline.** If `git` is not runnable, every test here skips with the reason printed —
 * loudly, never silently. A silent skip would report green for the one claim nothing else covers.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeFilesApi } from "@statewalker/vcs-utils-node";
import { type FilesApi, joinPath, writeText } from "@statewalker/webrun-files";
import { type Project, Workspace } from "@statewalker/workspace.core";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerVcs, type VcsNature, vcsNatureOf } from "../../src/runtime/vcs-nature.js";
import { detectNativeGit, nativeGitIn } from "../helpers/native-git-client.js";

const PROJECT = "demo";
const AUTHOR = { name: "GitNature Conformance", email: "conformance@statewalker.test" };

/** Probed once. `available === false` carries the reason the skips report. */
const git = detectNativeGit();

if (!git.available) {
  console.warn(
    `[T12 native-git conformance] SKIPPED — ${git.reason}. ` +
      "Contract invariant 6 (native-git compatibility) is UNVERIFIED in this run.",
  );
}

/** A `fetch` that must never be called: this suite is entirely local. */
const deps = {
  fetch: (() => {
    throw new Error("native-git conformance must not reach the network");
  }) as never,
};

const roots: string[] = [];

describe.skipIf(!git.available)(
  `native-git conformance (${git.version ?? "git unavailable"})`,
  () => {
    let root: string;
    let projectDir: string;
    let files: FilesApi;
    let workspace: Workspace;
    let nature: VcsNature;

    beforeEach(async () => {
      root = mkdtempSync(join(tmpdir(), "gitnature-conformance-"));
      roots.push(root);
      projectDir = join(root, PROJECT);
      await mkdir(projectDir, { recursive: true });

      files = createNodeFilesApi({ rootDir: root }) as unknown as FilesApi;
      workspace = new Workspace().setFileSystem(files, "conformance");
      registerVcs(workspace, deps);

      const project: Project | null = await workspace.getProject(PROJECT);
      if (!project) throw new Error(`no project: ${PROJECT}`);
      nature = vcsNatureOf(project);
    });

    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
    });

    /** `init` → write two files → `add(".")` → `commit`, all through the nature. */
    async function buildRepository(message = "initial commit"): Promise<string> {
      await nature.init({ author: AUTHOR });
      await writeText(files, joinPath(PROJECT, "README.md"), "# demo\n");
      await writeText(files, joinPath(PROJECT, "src/app.ts"), "export const answer = 42;\n");
      await nature.add(".");
      const outcome = await nature.commit({ message });
      if (!outcome.changed || !outcome.id) throw new Error("commit produced nothing to verify");
      return outcome.id;
    }

    it("git fsck finds a well-formed object graph", async () => {
      await buildRepository();

      // `--strict` and `--no-progress` so the check is the strongest git offers and the output
      // holds findings only. fsck reports dangling/broken objects on stderr and still exits 0 for
      // *dangling* ones, so the empty-output assertion is the real one — the exit code alone
      // would wave through a graph with unreachable garbage in it.
      const result = await nativeGitIn(projectDir).run("fsck", "--strict", "--no-progress");

      expect(`fsck: code=${result.code} stderr=${result.stderr} stdout=${result.stdout}`).toBe(
        "fsck: code=0 stderr= stdout=",
      );
    });

    it("git log --format=%H lists exactly the ids log() returns, in the same order", async () => {
      await buildRepository("first");
      await writeText(files, joinPath(PROJECT, "CHANGELOG.md"), "- first\n");
      await nature.add(".");
      const second = await nature.commit({ message: "second" });
      expect(second.changed).toBe(true);

      const ours = (await nature.log()).map((commit) => commit.id);
      expect(ours).toHaveLength(2);

      const theirs = (await nativeGitIn(projectDir).ok("log", "--format=%H"))
        .split("\n")
        .filter((line) => line !== "");

      // Order included: both are newest-first, so this pins the parent chain as well as the set.
      expect(theirs).toEqual(ours);
    });

    it("git status --porcelain is empty after a commit, and so is status()", async () => {
      await buildRepository();

      const porcelain = await nativeGitIn(projectDir).ok("status", "--porcelain");

      // Equality against "", not `.trim()` — a stray `?? something` line must fail here.
      expect(porcelain).toBe("");
      expect((await nature.status()).isClean()).toBe(true);
    });

    /**
     * `.project` — and the one place where the obvious assertion is a trap.
     *
     * **`git status --porcelain` cannot detect a broken exclude.** Measured, not assumed: with
     * `.git/info/exclude` emptied and everything else identical, porcelain is still exactly `""`
     * — because `add(".")` then *stages* `.project/nature.vcs.json`, `commit` records it, and a
     * committed file matching the index is nothing for status to report. Porcelain is empty
     * whether the exclude works or not, so on its own it is a vacuous check. The **discriminating**
     * view is `git ls-tree -r HEAD`: what git says the commit actually contains. Both are asserted,
     * and the control below proves which one carries the weight.
     */
    describe(".project stays out of the repository, as git itself reports it", () => {
      const CONTENT = ["README.md", "src/app.ts"];

      async function gitsView() {
        const nativeGit = nativeGitIn(projectDir);
        return {
          porcelain: await nativeGit.ok("status", "--porcelain"),
          // Untracked forced on: a bare `--porcelain` respects `status.showUntrackedFiles`.
          untracked: await nativeGit.ok("status", "--porcelain", "--untracked-files=all"),
          tracked: (await nativeGit.ok("ls-tree", "-r", "--name-only", "HEAD"))
            .split("\n")
            .filter((line) => line !== ""),
        };
      }

      it("git records only the project's own source, and reports nothing outstanding", async () => {
        await buildRepository();

        // The file is on disk — `init()` wrote it — so its absence from git's view is the
        // exclude working, not the file being missing.
        expect(await files.exists(joinPath(PROJECT, ".project/nature.vcs.json"))).toBe(true);

        const view = await gitsView();
        expect(view.tracked).toEqual(CONTENT);
        expect(view.porcelain).toBe("");
        expect(view.untracked).toBe("");
      });

      it("CONTROL: with the exclude erased, git records .project — and porcelain still says nothing", async () => {
        await nature.init({ author: AUTHOR });
        // The one mutation: erase what `init()` wrote, leaving the rest of the flow untouched.
        // Written with `node:fs` rather than the `FilesApi` so the fixture cannot be accused of
        // going through the code under test.
        writeFileSync(join(projectDir, ".git/info/exclude"), "");

        await writeText(files, joinPath(PROJECT, "README.md"), "# demo\n");
        await writeText(files, joinPath(PROJECT, "src/app.ts"), "export const answer = 42;\n");
        await nature.add(".");
        expect((await nature.commit({ message: "no exclude" })).changed).toBe(true);

        const view = await gitsView();
        // This is the fact the test above would otherwise assert vacuously.
        expect(view.tracked).toContain(".project/nature.vcs.json");
        // ...and this is why `porcelain === ""` proves nothing about the exclude on its own.
        expect(view.porcelain).toBe("");
      });
    });

    it("git cat-file reads our commit object: tree, message and the configured author", async () => {
      const id = await buildRepository("conformance subject");
      const nativeGit = nativeGitIn(projectDir);

      const raw = await nativeGit.ok("cat-file", "-p", "HEAD");
      const treeFromCommit = /^tree ([0-9a-f]{40})$/m.exec(raw)?.[1];
      const treeFromRevParse = (await nativeGit.ok("rev-parse", "HEAD^{tree}")).trim();

      expect(treeFromCommit).toBe(treeFromRevParse);
      expect(raw).toContain("conformance subject");
      // The identity from `nature.vcs.json` reached the object git parses — proving the
      // configured author survives our serialization, not merely our reader.
      expect(await nativeGit.ok("log", "-1", "--format=%an <%ae>")).toBe(
        `${AUTHOR.name} <${AUTHOR.email}>\n`,
      );
      expect((await nativeGit.ok("rev-parse", "HEAD")).trim()).toBe(id);
      // `openGitRepo` hardcodes `main`; git resolving HEAD to it is the on-disk half of that.
      expect((await nativeGit.ok("rev-parse", "--abbrev-ref", "HEAD")).trim()).toBe("main");
    });
  },
);

afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
});
