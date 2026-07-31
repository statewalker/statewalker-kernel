/**
 * HTTP remotes on `VcsNature`, end to end against an in-process smart-HTTP server.
 *
 * **On invariant 4 ("credentials never leave the `Secrets` store").** The default
 * `Secrets` adapter is `FilesBackedSecrets`, which persists **plaintext JSON, one
 * file per key, under the workspace system folder** (`.settings/secrets/`). So the
 * invariant is *not* "a credential never touches disk" — it is "a credential never
 * persists **outside** the `Secrets` store". The sentinel test below asserts exactly
 * that, and asserts the positive half too (the credential really did reach the wire),
 * because an implementation that simply never used credentials would satisfy the
 * negative half trivially.
 *
 * The system folder is **workspace-relative**, not project-relative. Here the
 * workspace root is `/` and the projects are `/a` and `/b`, so `.settings/` is
 * outside every project subtree. A workspace whose root *were* a project directory
 * would put `.settings/` inside the worktree, and `add(".")` would commit it —
 * that is a deployment constraint, not something this package can fix.
 */

import type { Commit, History } from "@statewalker/vcs-core";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import {
  DEFAULT_SYSTEM_FOLDER,
  initWorkspace,
  type Project,
  Secrets,
  Workspace,
} from "@statewalker/workspace.core";
import { beforeEach, describe, expect, it } from "vitest";
import { remoteCredentialsKey, UnknownRemoteError } from "../../src/remotes/index.js";
import { registerVcs, type VcsNature, vcsNatureOf } from "../../src/runtime/vcs-nature.js";
import {
  createInProcessGitServer,
  type InProcessGitServer,
  serverRefs,
} from "../helpers/in-process-git-server.js";

const decoder = new TextDecoder();
const AUTHOR = { name: "Test", email: "test@example.com" };

async function readText(files: MemFilesApi, path: string): Promise<string> {
  let text = "";
  for await (const chunk of files.read(path)) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

/** Every regular file under `root`, as `path → raw bytes decoded byte-for-byte`. */
async function everyFileUnder(files: MemFilesApi, root: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for await (const entry of files.list(root, { recursive: true })) {
    if (entry.kind !== "file") continue;
    const chunks: Uint8Array[] = [];
    for await (const chunk of files.read(entry.path)) chunks.push(chunk);
    const merged = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    found.set(entry.path, String.fromCharCode(...merged));
  }
  return found;
}

async function historyOfNature(nature: VcsNature): Promise<History> {
  const history = (await nature.git()).history;
  if (!history) throw new Error("no history");
  return history;
}

async function treeEntryNames(history: History, commit: Commit): Promise<string[]> {
  const tree = await history.trees.load(commit.tree);
  if (!tree) throw new Error("commit tree not found");
  const names: string[] = [];
  for await (const entry of tree) names.push(entry.name);
  return names;
}

describe("HTTP remotes", () => {
  let files: MemFilesApi;
  let workspace: Workspace;
  let server: InProcessGitServer;

  beforeEach(async () => {
    files = new MemFilesApi({
      initialFiles: { "a/README.md": "project a", "b/README.md": "project b" },
    });
    server = await createInProcessGitServer();
    workspace = initWorkspace({ workspace: new Workspace(), filesApi: files });
    // The injected `fetch` is the only route to the network. Nothing here stubs
    // `globalThis.fetch`, and nothing in the nature reads it.
    registerVcs(workspace, { fetch: server.fetch });
  });

  async function natureOf(name: string): Promise<VcsNature> {
    const project: Project | null = await workspace.getProject(name);
    if (!project) throw new Error(`no project: ${name}`);
    return vcsNatureOf(project);
  }

  /** An initialized project with one commit, ready to push. */
  async function committed(name: string): Promise<{ nature: VcsNature; id: string }> {
    const nature = await natureOf(name);
    await nature.init({ author: AUTHOR });
    await nature.add();
    const { id } = await nature.commit({ message: "first" });
    if (!id) throw new Error("nothing was committed");
    return { nature, id };
  }

  describe("remotes.addHttp / remotes.list", () => {
    it("writes remote.<name>.url into .git/config and reads it back", async () => {
      const nature = await natureOf("a");
      await nature.init();
      expect(await nature.remotes.list()).toEqual([]);

      await nature.remotes.addHttp("origin", server.url);

      expect(await nature.remotes.list()).toEqual([{ name: "origin", url: server.url }]);
      // The file, not just the API round-trip — the point of using `.git/config` is
      // that native git can read it.
      expect(await readText(files, "/a/.git/config")).toBe(
        [
          "[core]",
          "\trepositoryformatversion = 0",
          "\tfilemode = true",
          "\tbare = false",
          '[remote "origin"]',
          `\turl = ${server.url}`,
          "",
        ].join("\n"),
      );
    });

    it("keeps several remotes side by side", async () => {
      const nature = await natureOf("a");
      await nature.init();
      await nature.remotes.addHttp("origin", server.url);
      await nature.remotes.addHttp("upstream", "https://example.test/up.git");

      expect(await nature.remotes.list()).toEqual([
        { name: "origin", url: server.url },
        { name: "upstream", url: "https://example.test/up.git" },
      ]);
    });

    it("is idempotent — re-adding a remote does not duplicate or corrupt the section", async () => {
      // `GitWorkingCopyConfig` writes `[remote "origin"]` but parses that header back
      // as the section `remote."origin"`, quotes included. Set naively, the second
      // addHttp would hold both spellings and emit `[remote ""origin""]`, and every
      // later lookup would miss. The key canonicalisation is what keeps this stable.
      const nature = await natureOf("a");
      await nature.init();
      await nature.remotes.addHttp("origin", server.url);
      await nature.remotes.addHttp("origin", server.url);
      await nature.remotes.addHttp("origin", "https://example.test/moved.git");

      expect(await nature.remotes.list()).toEqual([
        { name: "origin", url: "https://example.test/moved.git" },
      ]);
      const written = await readText(files, "/a/.git/config");
      expect(written).toContain('[remote "origin"]');
      expect(written).not.toContain('""');
      expect(written.match(/\[remote /g)).toHaveLength(1);
    });

    it("refuses a URL that is not absolute HTTP(S)", async () => {
      const nature = await natureOf("a");
      await nature.init();
      await expect(nature.remotes.addHttp("origin", "origin")).rejects.toThrow(
        /invalid HTTP remote URL/,
      );
      await expect(nature.remotes.addHttp("origin", "git@example.test:x.git")).rejects.toThrow(
        /invalid HTTP remote URL/,
      );
    });

    it("refuses credentials embedded in the URL — they would land in .git/config", async () => {
      const nature = await natureOf("a");
      await nature.init();
      await expect(
        nature.remotes.addHttp("origin", "https://user:secret@example.test/x.git"),
      ).rejects.toThrow(/credentials/);
      expect(await readText(files, "/a/.git/config")).not.toContain("secret");
    });

    it("refuses to touch .git/config before there is a repository", async () => {
      const nature = await natureOf("a");
      await expect(nature.remotes.addHttp("origin", server.url)).rejects.toThrow(/init\(\)/);
      expect(await files.exists("/a/.git/config")).toBe(false);
    });

    // The two known limits of writing through `GitWorkingCopyConfig`. Both are
    // properties of `save()` re-serializing the whole file from a flat `Map`, and
    // both are pinned here so a change of writer is a visible contract change.
    it("known limit: save() re-serializes, so comments in .git/config are lost", async () => {
      const nature = await natureOf("a");
      await nature.init();
      await files.write("/a/.git/config", [
        new TextEncoder().encode("# hand-written note\n[core]\n\tfilemode = true\n"),
      ]);

      await nature.remotes.addHttp("origin", server.url);

      expect(await readText(files, "/a/.git/config")).not.toContain("hand-written note");
    });

    it("known limit: a repeated key collapses, so only one fetch refspec survives", async () => {
      const nature = await natureOf("a");
      await nature.init();
      await files.write("/a/.git/config", [
        new TextEncoder().encode(
          '[remote "origin"]\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n' +
            "\tfetch = +refs/tags/*:refs/tags/*\n",
        ),
      ]);

      await nature.remotes.addHttp("origin", server.url);

      const written = await readText(files, "/a/.git/config");
      expect(written).toContain("+refs/tags/*:refs/tags/*");
      expect(written).not.toContain("refs/remotes/origin/*");
    });
  });

  describe("push", () => {
    it("lands the commit on the server's own ref store", async () => {
      const { nature, id } = await committed("a");
      await nature.remotes.addHttp("origin", server.url);

      const outcome = await nature.push();

      expect(outcome.ok).toBe(true);
      expect(outcome.url).toBe(server.url);
      // NEVER assert the pushed id from the push result: the transport reports
      // `newObjectId: ""` for every update, so the porcelain surfaces no OID at all.
      // The server-side ref store is the only sound witness.
      expect(await serverRefs(server)).toEqual({ "refs/heads/main": id });

      const serverHistory = server.git.history;
      if (!serverHistory) throw new Error("server has no history");
      const commit = await serverHistory.commits.load(id);
      expect(commit?.message).toBe("first");
      // The objects came across too, not only the ref.
      expect(await treeEntryNames(serverHistory, commit as Commit)).toEqual(["README.md"]);
    });

    it("throws a nature-level error for an unknown remote name", async () => {
      const { nature } = await committed("a");

      // The porcelain would hand "nope" straight to `new Request()` — its
      // `resolveRemoteUrl` returns any string without "://" or "@" unchanged — and
      // blow up with `TypeError: Failed to parse URL`. The nature resolves the name
      // against its own store first and refuses before any request is built.
      await expect(nature.push("nope")).rejects.toThrow(UnknownRemoteError);
      await expect(nature.push("nope")).rejects.toThrow(/unknown remote 'nope'/);

      const error = await nature.push("nope").catch((e: unknown) => e);
      expect(String(error)).not.toMatch(/Failed to parse URL/);
      expect(server.requests).toEqual([]);
    });

    it("refuses to push a branch that has no commit yet", async () => {
      const nature = await natureOf("a");
      await nature.init();
      await nature.remotes.addHttp("origin", server.url);
      await expect(nature.push()).rejects.toThrow(/no commit/);
    });
  });

  describe("fetch", () => {
    it("brings a pushed commit into a second project", async () => {
      const { nature: a, id } = await committed("a");
      await a.remotes.addHttp("origin", server.url);
      await a.push();

      const b = await natureOf("b");
      await b.init({ author: AUTHOR });
      await b.remotes.addHttp("origin", server.url);

      const outcome = await b.fetch();

      expect(outcome.url).toBe(server.url);
      expect(Object.fromEntries(outcome.updated)).toEqual({ "refs/remotes/origin/main": id });
      expect(outcome.objectsImported).toBeGreaterThan(0);

      // The tracking ref is on disk where native git expects it …
      expect((await readText(files, "/b/.git/refs/remotes/origin/main")).trim()).toBe(id);
      // … and the objects really were imported, not just the ref written.
      // (`FetchCommand.storePack()` is an empty method body — the porcelain writes
      // the ref and drops the pack, so the nature imports it itself.)
      const bHistory = await historyOfNature(b);
      const commit = await bHistory.commits.load(id);
      expect(commit?.message).toBe("first");
      expect(await treeEntryNames(bHistory, commit as Commit)).toEqual(["README.md"]);

      // `b`'s own branch is untouched — a fetch is not a merge.
      expect((await bHistory.refs.resolve("refs/heads/main"))?.objectId).not.toBe(id);
    });

    it("throws a nature-level error for an unknown remote name", async () => {
      const nature = await natureOf("b");
      await nature.init();
      await expect(nature.fetch("nope")).rejects.toThrow(UnknownRemoteError);
      expect(server.requests).toEqual([]);
    });
  });

  describe("credentials (invariant 4)", () => {
    const SENTINEL = "sentinel-token-4f3a9c7e";

    it("sends them on the wire and writes them nowhere under the project", async () => {
      const { nature, id } = await committed("a");
      await nature.remotes.addHttp("origin", server.url, {
        credentials: { username: "gitnature", password: SENTINEL },
      });

      await nature.push();

      // Positive half — an implementation that never used credentials would pass
      // the negative half trivially, which is exactly the tautology to avoid.
      const authorized = server.requests.filter((request) => request.authorization);
      expect(authorized.length).toBeGreaterThan(0);
      expect(atob((authorized[0]?.authorization ?? "").replace(/^Basic /, ""))).toBe(
        `gitnature:${SENTINEL}`,
      );

      // Negative half — EVERY file under the project subtree, not two named ones.
      const projectFiles = await everyFileUnder(files, "/a");
      expect(projectFiles.size).toBeGreaterThan(3);
      const leaking = [...projectFiles]
        .filter(([, content]) => content.includes(SENTINEL))
        .map(([path]) => path);
      expect(leaking).toEqual([]);

      // The committed tree holds nothing from the workspace's own state either.
      const history = await historyOfNature(nature);
      const commit = await history.commits.load(id);
      const names = await treeEntryNames(history, commit as Commit);
      expect(names).toEqual(["README.md"]);
      expect(names).not.toContain(DEFAULT_SYSTEM_FOLDER);
      expect(names).not.toContain(".settings");

      // Ground rule 6, stated as a fact rather than a hope: the sentinel IS on disk,
      // in plaintext, inside the `Secrets` store — which lives outside the project.
      // Keyed on the project PATH, not its name: `projectName` is the last path
      // segment, so nested projects sharing one would share a credentials entry.
      const secretsPath = `/.settings/secrets/${encodeURIComponent(
        remoteCredentialsKey(nature.path, "origin"),
      )}.json`;
      expect(await readText(files, secretsPath)).toContain(SENTINEL);
      expect(secretsPath.startsWith("/a/")).toBe(false);
    });

    it("keeps the credential out of the error raised for a credentialed URL", async () => {
      // `InvalidRemoteUrlError` is the guard that exists to keep credentials out of
      // `.git/config` — and it fires exactly when userinfo is present, so it is the
      // one place in this package guaranteed to be holding a token when it formats a
      // message. `error.message` and `error.stack` reach every log and every UI.
      const nature = await natureOf("a");
      await nature.init();

      const error = await nature.remotes
        .addHttp("origin", `https://gitnature:${SENTINEL}@example.test/x.git`)
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(SENTINEL);
      expect((error as Error).stack ?? "").not.toContain(SENTINEL);
      expect(String(error)).not.toContain(SENTINEL);
      // Every own property, not just the two above: `url` is public and any structured
      // logger prints it.
      const own = Object.getOwnPropertyNames(error as object);
      expect(JSON.stringify(error, own)).not.toContain(SENTINEL);
      // Still says which URL it refused, so the message stays actionable.
      expect((error as Error).message).toContain("example.test");
    });

    it("keeps the credential out of the error raised for an unparseable URL", async () => {
      // The scheme check formats the URL too, and a non-`//` scheme carries its
      // userinfo through `new URL()` without landing in `parsed.username`.
      const nature = await natureOf("a");
      await nature.init();

      const error = await nature.remotes
        .addHttp("origin", `gitnature:${SENTINEL}@example.test/x.git`)
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(SENTINEL);
      expect((error as Error).stack ?? "").not.toContain(SENTINEL);
    });

    it("finds them again when the remote was added under a differently-cased name", async () => {
      // `remoteUrlKey` lower-cases (GitWorkingCopyConfig lower-cases every key it
      // parses), so `addHttp("Origin", …)` is stored and listed as `origin`. A
      // credentials key that did NOT lower-case put the secret somewhere `push`
      // could never look — an anonymous push and a bare 401.
      const { nature } = await committed("a");
      await nature.remotes.addHttp("Origin", server.url, {
        credentials: { username: "gitnature", password: SENTINEL },
      });

      expect((await nature.remotes.list()).map((r) => r.name)).toEqual(["origin"]);
      await nature.push("origin");

      const authorized = server.requests.filter((request) => request.authorization);
      expect(authorized.length).toBeGreaterThan(0);
      expect(atob((authorized[0]?.authorization ?? "").replace(/^Basic /, ""))).toBe(
        `gitnature:${SENTINEL}`,
      );
    });

    it("scopes them by project path, so two nested projects do not share a key", async () => {
      // `projectName` is the LAST path segment, so `x/inner` and `y/inner` are both
      // "inner" — one project's credentials would silently overwrite the other's.
      const nested = new MemFilesApi({
        initialFiles: { "x/inner/README.md": "x", "y/inner/README.md": "y" },
      });
      const nestedWorkspace = initWorkspace({ workspace: new Workspace(), filesApi: nested });
      registerVcs(nestedWorkspace, { fetch: server.fetch });

      const natures: VcsNature[] = [];
      for (const name of ["x/inner", "y/inner"]) {
        const project = await nestedWorkspace.getProject(name);
        if (!project) throw new Error(`no project: ${name}`);
        natures.push(vcsNatureOf(project));
      }
      const [first, second] = natures as [VcsNature, VcsNature];

      await first.init({ author: AUTHOR });
      await first.add();
      await first.commit({ message: "x" });
      await first.remotes.addHttp("origin", server.url, {
        credentials: { username: "x-user", password: `${SENTINEL}-x` },
      });

      await second.init({ author: AUTHOR });
      await second.remotes.addHttp("origin", server.url, {
        credentials: { username: "y-user", password: `${SENTINEL}-y` },
      });

      // The second project's write must not have replaced the first's credentials.
      await first.push();
      const authorized = server.requests.filter((request) => request.authorization);
      expect(authorized.length).toBeGreaterThan(0);
      expect(atob((authorized[0]?.authorization ?? "").replace(/^Basic /, ""))).toBe(
        `x-user:${SENTINEL}-x`,
      );
    });

    it("stores them through the Secrets adapter, not beside the URL", async () => {
      const nature = await natureOf("a");
      await nature.init();
      await nature.remotes.addHttp("origin", server.url, {
        credentials: { username: "gitnature", password: SENTINEL },
      });

      const secrets = workspace.requireAdapter(Secrets);
      expect(await secrets.get(remoteCredentialsKey(nature.path, "origin"))).toEqual({
        username: "gitnature",
        password: SENTINEL,
      });
      expect(await readText(files, "/a/.git/config")).not.toContain(SENTINEL);
    });
  });
});
