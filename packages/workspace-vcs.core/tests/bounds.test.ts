import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Contract invariants 2 and 3, as a **test** rather than as a ritual.
 *
 * > 2. `vcs-workspace` source is untouched — its HARD BAN (never link Axis A to
 * >    Axis B) holds.
 * > 3. `workspace.core` is untouched — no `project.files` public API, no widened
 * >    `ProjectAdapter`.
 *
 * Both held in fact through the whole build, but the gate was a bash snippet
 * living in a plan document: no test, no script, no hook, and therefore a one-time
 * manual check that nothing re-runs. An invariant nothing enforces is a comment.
 *
 * The comparison is against the branch point (`merge-base` with `main`), not the
 * working tree, so it catches a violation that was committed as well as one that
 * is merely present.
 */

const PACKAGE = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Repository root of a submodule, and the paths inside it that must not move. */
interface Bound {
  /** Path to the git repository, relative to this package. */
  repo: string;
  /** Pathspecs inside it that the feature may not touch. */
  paths: string[];
  invariant: string;
}

const BOUNDS: Bound[] = [
  {
    repo: "../../../vcs",
    paths: ["packages/workspace/src"],
    invariant: "2 — vcs-workspace source is untouched",
  },
  {
    repo: "../..",
    paths: ["packages/workspace.core"],
    invariant: "3 — workspace.core is untouched",
  },
];

/** `git` output, or a marker string the assertion can report verbatim. */
function gitIn(repo: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", resolve(PACKAGE, repo), ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    return `GIT FAILED: ${(error as Error).message}`;
  }
}

describe("contract bounds — invariants 2 and 3", () => {
  for (const bound of BOUNDS) {
    it(`invariant ${bound.invariant}`, () => {
      const base = gitIn(bound.repo, ["merge-base", "HEAD", "main"]);
      // A repo with no `main` (a detached CI checkout) must say so loudly rather
      // than silently pass: an empty diff against nothing is not evidence.
      expect(base).toMatch(/^[0-9a-f]{40}$/);

      const changed = gitIn(bound.repo, ["diff", "--name-only", base, "--", ...bound.paths]);
      expect(changed).toBe("");
    });
  }
});
