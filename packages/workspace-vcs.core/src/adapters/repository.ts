import { CheckoutStatus, EmptyCommitError, type Git } from "@statewalker/vcs-commands";
import type { Checkout, Worktree } from "@statewalker/vcs-working-tree";
import { manifestOf, type Repository } from "@statewalker/vcs-workspace";
import type { FilesApi } from "@statewalker/webrun-files";
import { FilteredFilesApi, newPathFilter } from "@statewalker/webrun-files-composite";
import type { HashContent } from "../util/hash-content.js";
import { historyOf } from "./repository-facade.js";

/** Where the repository lives inside the project — mirrors `openGitRepo`. */
const GIT_DIR = "/.git";

/** What a commit is called when `Repository.commit` is given no message. */
const DEFAULT_COMMIT_MESSAGE = "workspace checkpoint";

/**
 * The `.git`-excluding view of a project's files — **exactly what
 * {@link createGitRepository}'s `manifest()` measures**.
 *
 * Exported because `publish` does not call `repository.manifest()`: it computes
 * its checkpoint id as `manifestOf(ws.workingTree, hashContent)` itself
 * (`publish.ts:35`). Hand it `trackedFilesOf(files)` as `workingTree` and the
 * two ids agree; hand it the raw project view and they never can.
 *
 * Why the exclusion is mandatory rather than tidy: `manifestOf` → `buildAnchor`
 * does an **unfiltered** recursive list and hashes every file it finds. Over the
 * raw view that includes `.git/index`, `.git/HEAD` and `.git/objects/**`, so
 * *staging a file* moves the "working-tree" manifest and no checkpoint could
 * ever be re-derived from the files alone. `FilteredFilesApi` is the right
 * decorator here specifically because it forwards the `ListOptions` argument —
 * a wrapper that dropped it would silently flatten the manifest to root level.
 *
 * The alternative — a `filter` parameter on `manifestOf` — is contract-forbidden
 * (it edits `vcs/packages/workspace/src/**`) and was not attempted.
 *
 * **Scope note:** only `.git` is hidden. The workbench's own `.project` folder
 * IS part of this manifest even though `.git/info/exclude` keeps it out of every
 * commit, so touching per-project workbench state moves the manifest without
 * moving HEAD. That is the caller's call to make — pass an already-filtered
 * `files` to hide more.
 */
export function trackedFilesOf(files: FilesApi): FilesApi {
  return new FilteredFilesApi(files, newPathFilter(GIT_DIR));
}

/**
 * The `vcs-workspace` {@link Repository} over a file-backed `Git` — the adapter
 * that lets `publish` / `restore` drive this nature's real `.git`.
 *
 * `files` is a third argument and not derivable from `git`: `manifestOf` needs a
 * `FilesApi` and the `Git` façade exposes none (`Worktree` has no `files`
 * member). Pass the same project-rooted view the repository was opened on —
 * `repoFilesOf(project)`.
 *
 * `hashContent` is likewise injected rather than chosen, so a caller can hold
 * one instance across `manifest()` and `publish()`; {@link hashContentSha256}
 * is the one this package ships.
 */
export function createGitRepository(
  git: Git,
  files: FilesApi,
  hashContent: HashContent,
): Repository {
  const tracked = trackedFilesOf(files);

  return {
    manifest: () => manifestOf(tracked, hashContent),
    head: () => headOf(git),
    hasChanges: () => hasWorkingTreeChanges(git),
    commit: (opts) => commitWorktree(git, opts.message),
    checkout: (commit) => checkoutCommit(git, commit),
  };
}

/** The commit HEAD resolves to, or `undefined` before the first commit. */
async function headOf(git: Git): Promise<string | undefined> {
  return (await historyOf(git).refs.resolve("HEAD"))?.objectId;
}

/**
 * Whether the **working tree** holds anything not yet committed.
 *
 * This is `commitOnlyWhenChanged`'s only input, so a wrong answer here is a
 * skipped commit or an endless one — never an error. Both obvious sources are
 * wrong, measured on this assembly:
 *
 * - **`git.workingCopy.getStatus()`** is a `MemoryWorkingCopy` method whose own
 *   comment says "Returns a simplified status for testing": `files: []`,
 *   `isClean: true`, `hasUnstaged: false` are **hardcoded literals** (only
 *   `branch` and `head` are computed). `!isClean` is therefore always `false`.
 * - **`StatusCalculatorImpl`** compares worktree to index by size + mtime and
 *   treats any file younger than the index as "racily clean ⇒ maybe modified".
 *   On a freshly committed clean tree it answers `hasUnstaged: true`, so it is
 *   wrong in the other direction.
 * - **`git.status()`** (`StatusCommand`) is index-vs-HEAD only and never reads
 *   the worktree at all.
 *
 * So the worktree half is an explicit **content-hash** diff against the index —
 * `Worktree.computeHash` is the git blob id of the file on disk, directly
 * comparable to the index entry's `objectId` — and the staged half delegates to
 * `git.status()`, which is exactly what that command is for.
 *
 * Ignored files count only when they are already tracked: `commit()` stages with
 * `add(".")`, which honours `.git/info/exclude`, so an ignored untracked file is
 * something no commit would ever pick up.
 */
async function hasWorkingTreeChanges(git: Git): Promise<boolean> {
  const worktree = worktreeOf(git);
  const staging = checkoutOf(git).staging;

  const staged = new Map<string, string>();
  for await (const entry of staging.entries()) {
    // A conflict stage is by definition unresolved, hence uncommitted.
    if (entry.stage !== 0) return true;
    staged.set(entry.path, entry.objectId);
  }

  let matched = 0;
  for await (const entry of worktree.walk({ includeIgnored: true })) {
    if (entry.isDirectory) continue;
    const indexed = staged.get(entry.path);
    if (indexed === undefined) {
      if (entry.isIgnored) continue;
      return true; // untracked, and `add(".")` would stage it
    }
    matched++;
    if ((await worktree.computeHash(entry.path)) !== indexed) return true;
  }
  // Every index entry the walk did not reach is a file deleted from the
  // worktree — `add(".")` stages deletions, so that is a real change.
  if (matched !== staged.size) return true;

  return (await git.status().call()).hasUncommittedChanges();
}

/**
 * Stage the whole worktree and record it as a commit.
 *
 * `add(".")` first is not a convenience: `CommitCommand` writes the tree from
 * the **index**, so without it `publish` would commit whatever happened to be
 * staged — an empty tree on a fresh repository. `Repository` has no "stage"
 * step, so this method owns one; the index mutation is a documented effect.
 *
 * The three outcomes, and why they are shaped this way:
 *
 * - **Something to commit** → `{commit: <new id>, changed: true}`.
 * - **Nothing to commit, with history** → `CommitCommand` throws
 *   `EmptyCommitError` and `CommitResult` carries no `changed` field, while
 *   `Repository.commit` must return a **non-optional** id. The id therefore
 *   comes from HEAD: `{commit: head, changed: false}`.
 * - **Nothing to commit, no history** → **throws**. No commit id exists, and the
 *   return type cannot express its absence. Left to the porcelain this case is
 *   worse than an error: the empty guard is gated on `parents.length > 0`, so it
 *   would write an empty root commit and return an id for a state that has none.
 *
 * The author is the porcelain's default (`Unknown <unknown@example.com>`) —
 * `Repository.commit` has no author field. `VcsNature.commit` is the surface
 * that carries the project's configured identity.
 */
async function commitWorktree(
  git: Git,
  message?: string,
): Promise<{ commit: string; changed: boolean }> {
  await git.add().addFilepattern(".").call();

  if (!(await headOf(git)) && (await checkoutOf(git).staging.getEntryCount()) === 0) {
    throw new Error(
      "commit: nothing to commit and this repository has no commit yet — " +
        "Repository.commit must return a commit id and none exists. Write a file first.",
    );
  }

  try {
    const { id } = await git
      .commit()
      .setMessage(message ?? DEFAULT_COMMIT_MESSAGE)
      .call();
    return { commit: id, changed: true };
  } catch (error) {
    if (!(error instanceof EmptyCommitError)) throw error;
    const head = await headOf(git);
    // Unreachable: EmptyCommitError is only raised when a parent commit exists.
    if (!head) throw error;
    return { commit: head, changed: false };
  }
}

/**
 * Reset the working tree to `commit` — `restore`'s only engine call.
 *
 * A raw commit id is accepted: `CheckoutCommand` resolves branches, tags, refs
 * and then object ids, and detaches HEAD onto the last of those.
 *
 * **The status inspection is the whole point.** `checkoutBranch` does not throw
 * when staged entries differ from HEAD — it **returns `{status: CONFLICTS}`**
 * with the offending paths — and `Repository.checkout` returns `void`. Ignore
 * the result and `restore` reports success over a working tree it never touched.
 * `setForced(true)` would suppress the conflict instead, discarding uncommitted
 * work; that is destructive and deliberately not done here — a caller who wants
 * it can commit or reset first.
 *
 * Known limitation, inherited: `checkoutBranch` writes the target tree over the
 * worktree but never **removes** files absent from it, so a file added after
 * `commit` survives the checkout untracked.
 */
async function checkoutCommit(git: Git, commit: string): Promise<void> {
  const result = await git.checkout().setName(commit).call();
  if (result.status !== CheckoutStatus.OK) {
    const detail = result.conflicts.length ? `: ${result.conflicts.join(", ")}` : "";
    throw new Error(
      `checkout: '${commit}' was not checked out — status ${result.status}${detail}. ` +
        "Commit or discard the staged changes first.",
    );
  }
}

/** The worktree behind a `Git`, or throw — `Git.worktree` is optional. */
function worktreeOf(git: Git): Worktree {
  const worktree = git.worktree;
  if (!worktree) throw new Error("git has no worktree");
  return worktree;
}

/** The checkout state behind a `Git`, or throw — `Git.checkoutState` is optional. */
function checkoutOf(git: Git): Checkout {
  const checkout = git.checkoutState;
  if (!checkout) throw new Error("git has no checkout state");
  return checkout;
}
