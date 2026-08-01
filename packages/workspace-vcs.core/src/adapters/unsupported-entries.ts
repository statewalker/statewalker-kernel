import type { Git } from "@statewalker/vcs-commands";
import { FileMode, type FileModeValue } from "@statewalker/vcs-core";

/**
 * An index entry whose file mode this nature cannot carry without corrupting it.
 *
 * Raised — never worked around — by every path that would stage, commit or
 * measure such a repository. See {@link assertSupportedIndex} for why refusal is
 * the only honest answer here.
 */
export class UnsupportedEntryError extends Error {
  constructor(
    /** Repository-relative path of the offending index entry. */
    readonly path: string,
    /** The mode the index holds for it, e.g. `0o120000` for a symlink. */
    readonly mode: number,
  ) {
    super(
      `unsupported entry '${path}': the index records mode ${mode.toString(8)} ` +
        `(${describeMode(mode)}), and this nature can only carry regular files ` +
        `(${FileMode.REGULAR_FILE.toString(8)}). ` +
        "Staging it would rewrite the mode and, for a symlink, replace the link in " +
        "history with a regular file holding its target's content — so it is refused " +
        "instead. See the 'Known limits' section of this package's CONTEXT.md.",
    );
    this.name = "UnsupportedEntryError";
  }
}

/** A human name for a git file mode, for the error message. */
function describeMode(mode: number): string {
  switch (mode) {
    case FileMode.SYMLINK:
      return "symbolic link";
    case FileMode.GITLINK:
      return "gitlink / submodule";
    case FileMode.EXECUTABLE_FILE:
      return "executable file";
    case FileMode.TREE:
      return "tree";
    default:
      return "unrecognised";
  }
}

/** The one mode this nature can round-trip. */
const SUPPORTED_MODE: number = FileMode.REGULAR_FILE;

/**
 * Refuse one index entry whose mode is not {@link SUPPORTED_MODE}.
 *
 * Exported so a caller already walking the index — `hasWorkingTreeChanges` — can
 * check as it goes rather than walking it twice.
 */
export function assertSupportedEntry(entry: { path: string; mode: FileModeValue | number }): void {
  if (entry.mode === SUPPORTED_MODE) return;
  throw new UnsupportedEntryError(entry.path, entry.mode);
}

/**
 * Refuse the whole repository when its index holds a mode this nature would
 * corrupt — **before** anything is staged.
 *
 * The root cause is one line in `@statewalker/vcs-store-files`:
 * `FileWorktree.getFileMode` returns `FileMode.REGULAR_FILE` for every path,
 * unconditionally. `AddCommand` stages `worktreeEntry.mode`, so `add(".")` over an
 * adopted repository rewrites every `100755` entry to `100644` and turns every
 * `120000` symlink into a regular file holding its target's bytes. Measured
 * against git 2.43.0: `git fsck --strict` reports nothing, and
 * `hasWorkingTreeChanges` cannot see it either — that comparison is content-only.
 *
 * Fixing `getFileMode` means editing `store-files`, which this feature's contract
 * hard-bans. The ratified alternative is to **detect and refuse loudly**: a
 * repository holding a symlink, a gitlink or an executable is one GitNature will
 * not commit to, and saying so is strictly better than a silent, irreversible
 * rewrite of the caller's history.
 *
 * **The index is the only place a true mode survives**, which sets this guard's
 * reach: it sees what a native `git add` recorded, and cannot see an *untracked*
 * symlink or executable, because the worktree view reports `REGULAR_FILE` for
 * everything. That limit is documented rather than hidden.
 */
export async function assertSupportedIndex(git: Git): Promise<void> {
  const checkout = git.checkoutState;
  if (!checkout) throw new Error("git has no checkout state");
  for await (const entry of checkout.staging.entries()) assertSupportedEntry(entry);
}
