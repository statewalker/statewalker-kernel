/**
 * A wrapper around the **real** `git` binary, for the native-git conformance suite.
 *
 * **Ported, not imported.** The obvious source —
 * `vcs/packages/integration-tests/tests/transport/http/native-git/helpers/native-git-client.ts` —
 * lives in a package that is `"private": true` with **no `exports` and no `files`**, and is not a
 * dependency of this one, so nothing there is reachable from here. Its shape is also wrong for this
 * suite: it `mkdtemp`s its own directory and is built around `clone`/`push`, whereas conformance
 * has to point real git at a directory **we** built through `VcsNature` and ask what it sees.
 *
 * Two deliberate differences from the original beyond that:
 *
 * - **`execFile`, not `exec`.** The original interpolates arguments into a shell string; here the
 *   arguments carry commit messages and paths, and a shell would re-interpret them.
 * - **The ambient git configuration and locale are switched off.** `GIT_CONFIG_GLOBAL`/
 *   `GIT_CONFIG_SYSTEM` point at `/dev/null`, so a developer's `~/.gitconfig` (a
 *   `core.excludesFile`, an alias, a `safe.directory` policy) cannot change what this suite
 *   observes, and `LC_ALL=C` pins the messages. Both are load-bearing rather than tidiness: git
 *   **translates its diagnostics** — on the machine this was written, a corrupted object reported
 *   `objet corrompu ou manquant`. Any assertion that reads `stderr` would be locale-dependent
 *   without this.
 */

import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Environment that isolates a `git` invocation from the machine it runs on. */
const ISOLATED_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
  LANG: "C",
};

/** The result of one `git` invocation — never trimmed, so "empty" stays checkable. */
export interface GitResult {
  stdout: string;
  stderr: string;
  /** `0` unless git failed; a non-zero code is reported, never thrown. */
  code: number;
}

/** What {@link detectNativeGit} found on this machine. */
export interface NativeGitAvailability {
  available: boolean;
  /** e.g. `"git version 2.43.0"` — present only when `available`. */
  version?: string;
  /** Why it is unavailable — carried so a skip can state its reason instead of being silent. */
  reason?: string;
}

let cached: NativeGitAvailability | undefined;

/**
 * Whether a usable `git` is on `PATH`, memoised — probed once per process.
 *
 * Returns a reason rather than throwing, because the caller's job is to turn an absent git into a
 * *loud* skip. A suite that silently passes when git is missing would report green for the one
 * claim it exists to test.
 */
export function detectNativeGit(): NativeGitAvailability {
  if (cached) return cached;
  try {
    const version = execFileSync("git", ["--version"], {
      encoding: "utf-8",
      env: ISOLATED_ENV,
    }).trim();
    cached = { available: true, version };
  } catch (error) {
    cached = {
      available: false,
      reason: `git is not runnable on PATH: ${(error as Error).message}`,
    };
  }
  return cached;
}

/** Real `git`, bound to one working directory. */
export interface NativeGit {
  /** Run `git <args>` in the directory; non-zero exit is returned, not thrown. */
  run(...args: string[]): Promise<GitResult>;
  /** Run `git <args>` and fail loudly on a non-zero exit — for steps that must succeed. */
  ok(...args: string[]): Promise<string>;
}

/**
 * Bind real `git` to `dir`.
 *
 * `-C <dir>` rather than `cwd`, matching how the original helper addressed its repository, and so
 * the failure when `dir` holds no repository is git's own message rather than a spawn error.
 */
export function nativeGitIn(dir: string): NativeGit {
  async function run(...args: string[]): Promise<GitResult> {
    try {
      const { stdout, stderr } = await execFileAsync("git", ["-C", dir, ...args], {
        encoding: "utf-8",
        env: ISOLATED_ENV,
      });
      return { stdout, stderr, code: 0 };
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string; code?: number; message: string };
      return {
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? failure.message,
        code: typeof failure.code === "number" ? failure.code : 1,
      };
    }
  }

  return {
    run,
    async ok(...args: string[]): Promise<string> {
      const result = await run(...args);
      if (result.code !== 0) {
        throw new Error(`git ${args.join(" ")} failed (${result.code}): ${result.stderr}`);
      }
      return result.stdout;
    },
  };
}
