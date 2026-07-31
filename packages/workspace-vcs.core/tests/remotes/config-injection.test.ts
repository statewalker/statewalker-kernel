/**
 * `.git/config` injection — the write path, not the read path.
 *
 * `addHttpRemote` interpolates two caller-supplied strings into a file with a
 * line-oriented grammar: the remote **name** becomes the subsection of
 * `[remote "<name>"]`, and the **URL** becomes the value of `url = …`.
 * `GitWorkingCopyConfig.serializeValue` escapes a `"` and nothing else — in
 * particular never a newline — so both are injection points into git's own
 * configuration, which git honours on every operation.
 *
 * Two distinct holes, tested separately because their mechanics differ:
 *
 * - **The name** is written verbatim. A newline in it ends the `[remote "…"]`
 *   header line and starts a new section, so `core.sshCommand` can be planted —
 *   a command git executes for every ssh operation. It is invisible in both
 *   `git remote -v` and this nature's own `list()`, because neither reads the
 *   section it created.
 * - **The URL** is validated as a parsed `URL` but stored as the **raw string**.
 *   The WHATWG parser strips `\t\n\r` *before* parsing, so the validation sees a
 *   clean URL while the bytes that reach the file still carry the control
 *   characters. Result: `fatal: bad config line N` — the repository stops being
 *   readable by native git at all (contract invariant 6).
 *
 * The URL half is checked against **real git**, because "does this file still
 * parse" is a question only git's own parser can answer.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodeFilesApi } from "@statewalker/vcs-utils-node";
import type { FilesApi } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { type Project, Workspace } from "@statewalker/workspace.core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvalidRemoteNameError } from "../../src/remotes/index.js";
import { registerVcs, type VcsNature, vcsNatureOf } from "../../src/runtime/vcs-nature.js";
import { detectNativeGit, nativeGitIn } from "../helpers/native-git-client.js";

const decoder = new TextDecoder();
const PROJECT = "demo";

/** A `fetch` that must never be called: nothing here reaches the network. */
const deps = {
  fetch: (() => {
    throw new Error("config-injection tests must not reach the network");
  }) as never,
};

async function readText(files: FilesApi, path: string): Promise<string> {
  let text = "";
  for await (const chunk of files.read(path)) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

describe("addHttp rejects a remote NAME that would inject config", () => {
  let files: MemFilesApi;
  let nature: VcsNature;

  beforeEach(async () => {
    files = new MemFilesApi({ initialFiles: { [`${PROJECT}/README.md`]: "hello" } });
    const workspace = new Workspace().setFileSystem(files, "injection");
    registerVcs(workspace, deps);
    const project: Project | null = await workspace.getProject(PROJECT);
    if (!project) throw new Error(`no project: ${PROJECT}`);
    nature = vcsNatureOf(project);
    await nature.init();
  });

  it("refuses the sshCommand payload, and leaves .git/config byte-for-byte alone", async () => {
    const before = await readText(files, `/${PROJECT}/.git/config`);
    // Closes the `[remote "` header, opens `[core]`, plants a command git RUNS.
    const payload = 'x"]\n[core]\n\tsshCommand=/tmp/pwn.sh\n[a "b';

    await expect(nature.remotes.addHttp(payload, "https://example.test/r.git")).rejects.toThrow(
      InvalidRemoteNameError,
    );

    const after = await readText(files, `/${PROJECT}/.git/config`);
    expect(after).toBe(before);
    expect(after).not.toContain("sshCommand");
    expect(await nature.remotes.list()).toEqual([]);
  });

  it("refuses whitespace and quotes — the silent-rename cases", async () => {
    // `parseGitConfig` collapses whitespace in a section header to a dot, so
    // `[remote "up stream"]` reads back as `up.stream`; a quote is dropped
    // outright by `configEntries`. Both make a remote that was just added
    // unfindable, which is a rename the caller never asked for.
    await expect(nature.remotes.addHttp("up stream", "https://example.test/r.git")).rejects.toThrow(
      InvalidRemoteNameError,
    );
    await expect(nature.remotes.addHttp('a"b', "https://example.test/r.git")).rejects.toThrow(
      InvalidRemoteNameError,
    );
    await expect(nature.remotes.addHttp("", "https://example.test/r.git")).rejects.toThrow(
      InvalidRemoteNameError,
    );
    expect(await nature.remotes.list()).toEqual([]);
  });

  it("still accepts the names git itself accepts", async () => {
    await nature.remotes.addHttp("origin", "https://example.test/o.git");
    await nature.remotes.addHttp("up-stream.2_x", "https://example.test/u.git");

    expect(await nature.remotes.list()).toEqual([
      { name: "origin", url: "https://example.test/o.git" },
      { name: "up-stream.2_x", url: "https://example.test/u.git" },
    ]);
  });
});

const git = detectNativeGit();

if (!git.available) {
  console.warn(
    `[F2 config-injection via URL] SKIPPED — ${git.reason}. ` +
      "Whether the written .git/config still parses is UNVERIFIED in this run.",
  );
}

describe.skipIf(!git.available)("addHttp keeps .git/config parseable by real git", () => {
  let root: string;
  let projectDir: string;
  let files: FilesApi;
  let nature: VcsNature;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "gitnature-injection-"));
    projectDir = join(root, PROJECT);
    await mkdir(projectDir, { recursive: true });

    files = createNodeFilesApi({ rootDir: root }) as unknown as FilesApi;
    const workspace = new Workspace().setFileSystem(files, "injection");
    registerVcs(workspace, deps);
    const project: Project | null = await workspace.getProject(PROJECT);
    if (!project) throw new Error(`no project: ${PROJECT}`);
    nature = vcsNatureOf(project);
    await nature.init();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("a URL carrying a newline never reaches the file", async () => {
    // `new URL()` strips the `\n` and `\t` before parsing, so `assertHttpRemoteUrl`
    // sees `https://h.test/r.git[core]sshCommand=/tmp/pwn.sh` and passes it —
    // while the RAW string still holds the newlines that end the `url = …` line.
    const payload = "https://h.test/r.git\n[core]\n\tsshCommand=/tmp/pwn.sh";

    await expect(nature.remotes.addHttp("origin", payload)).rejects.toThrow(
      /invalid HTTP remote URL/,
    );

    // The file real git reads must still parse, and must not have grown a `[core]`
    // key nobody asked for.
    const listed = await nativeGitIn(projectDir).run("config", "--list", "--local");
    expect(`code=${listed.code} stderr=${listed.stderr}`).toBe("code=0 stderr=");
    expect(listed.stdout).not.toContain("sshcommand");
    expect(await readText(files, `/${PROJECT}/.git/config`)).not.toContain("sshCommand");
  });

  it("stores the parsed href, so native git reads back exactly what list() reports", async () => {
    // Not cosmetic: `parsed.href` is the string the validation actually inspected.
    // Storing anything else means the value on disk was never the value that was
    // checked. `//` in the path is a case where the two differ visibly.
    await nature.remotes.addHttp("origin", "https://h.test//a/../r.git");

    const stored = (
      await nativeGitIn(projectDir).ok("config", "--get", "remote.origin.url")
    ).trim();
    expect(stored).toBe(new URL("https://h.test//a/../r.git").href);
    expect(await nature.remotes.list()).toEqual([{ name: "origin", url: stored }]);
  });
});
