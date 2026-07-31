import { EmptyCommitError } from "@statewalker/vcs-commands";

/**
 * Whether `error` is the porcelain's "nothing to commit" signal.
 *
 * `instanceof` **and** a name check, because `instanceof` alone is fragile here in
 * a way that is specific to this workspace rather than theoretical: nine of the
 * `@statewalker/vcs-*` packages resolve to their built `dist/` while others resolve
 * to `src/`, so two copies of `vcs-commands` can be live in one process and the
 * `EmptyCommitError` a command throws need not be the class this module imported.
 * A missed match is not a caught error — it is a caller told a commit failed when
 * nothing was wrong, or (with the check the other way round) told nothing was wrong
 * when the commit failed.
 *
 * The name check is deliberately narrow: it matches the one sentinel name, so an
 * ENOSPC, a corrupt object or an invalid author still propagates.
 */
export function isEmptyCommitError(error: unknown): boolean {
  return (
    error instanceof EmptyCommitError ||
    (typeof error === "object" && error !== null && (error as Error).name === "EmptyCommitError")
  );
}
