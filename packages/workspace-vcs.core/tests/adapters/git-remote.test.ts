/**
 * `createHttpGitRemote` / `createDuplexGitRemote` — the `vcs-workspace`
 * `GitRemote` adapters.
 *
 * **The one thing this suite exists to pin.** `GitRemote.push` must answer with
 * `{ commit }` — the commit now on the remote ref — while *neither* transport
 * ever reports an object id on success:
 *
 * - `httpPush` writes success entries as the bare literal `{ success: true }`
 *   (`transport/src/adapters/http/http-client.ts:521-538`); `newOid` appears on
 *   `RefPushStatus` only where a failure is constructed.
 * - `pushOverDuplex` returns the bare literal `{ success: true }` with **no
 *   `refStatus` at all** (`transport/src/operations/push-over-duplex.ts:98-100`).
 *
 * So the commit id is resolved **locally, from `git.history.refs`, before the
 * push**, and the transport result is used for one thing only: deciding whether
 * the push succeeded. Any rule of the form "success but no `newOid` ⇒ throw"
 * would throw on every successful push on both transports.
 *
 * The two result shapes are different, so the failure tables are split per
 * transport rather than unified.
 */

import type { Git } from "@statewalker/vcs-commands";
import type { History } from "@statewalker/vcs-core";
import {
  type Duplex,
  type PushResult,
  type RefStore,
  serveRepoOverWebrun,
  webrunClientDuplex,
} from "@statewalker/vcs-transport";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createDuplexGitRemote,
  createHttpGitRemote,
  duplexPushOutcome,
  duplexRefspecOf,
  httpPushOutcome,
  httpRefspecOf,
  type PushTarget,
  RemotePushError,
} from "../../src/adapters/git-remote.js";
import { refStoreOf } from "../../src/adapters/ref-store.js";
import { historyOf, repositoryFacadeOf } from "../../src/adapters/repository-facade.js";
import { openGitRepo } from "../../src/runtime/git-assembly.js";
import {
  createInProcessGitServer,
  type InProcessGitServer,
  serverRefs,
} from "../helpers/in-process-git-server.js";

const AUTHOR = { name: "Test", email: "test@example.com" };
const decoder = new TextDecoder();

/** The `n`-th commit id, or a loud failure — `ids` is index-checked under strict TS. */
function commitId(ids: string[], index: number): string {
  const id = ids[index];
  if (!id) throw new Error(`no commit #${index} was created`);
  return id;
}

/** A local repository with `n` commits on `refs/heads/main`, newest last. */
async function localRepo(commits: Array<Record<string, string>>): Promise<{
  git: Git;
  files: MemFilesApi;
  history: History;
  ids: string[];
}> {
  const files = new MemFilesApi();
  const git = await openGitRepo(files, { create: true });
  const ids: string[] = [];
  for (const [index, tree] of commits.entries()) {
    for (const [path, content] of Object.entries(tree)) {
      await files.write(path, [new TextEncoder().encode(content)]);
    }
    await git.add().addFilepattern(".").call();
    const result = await git
      .commit()
      .setMessage(`c${index}`)
      .setAuthor(AUTHOR.name, AUTHOR.email)
      .call();
    ids.push((result as unknown as { id: string }).id);
  }
  return { git, files, history: historyOf(git), ids };
}

/** The in-process duplex counterpart of {@link createInProcessGitServer}. */
async function createDuplexServer(): Promise<{
  connect: () => Duplex;
  refStore: RefStore;
  connects: number;
}> {
  const files = new MemFilesApi();
  const git = await openGitRepo(files, { create: true });
  const refStore = refStoreOf(historyOf(git));
  const handler = serveRepoOverWebrun({
    repository: repositoryFacadeOf(git),
    refStore,
    service: "git-receive-pack",
  });
  const state = {
    refStore,
    connects: 0,
    connect(): Duplex {
      state.connects += 1;
      return webrunClientDuplex(handler);
    },
  };
  return state;
}

/** A `Duplex` that is already at EOF — the transport cannot read an advertisement. */
function deadDuplex(): Duplex {
  return {
    async *[Symbol.asyncIterator]() {
      // no bytes, ever
    },
    write() {},
  };
}

async function readText(files: MemFilesApi, path: string): Promise<string> {
  let text = "";
  for await (const chunk of files.read(path)) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

function target(overrides: Partial<PushTarget> = {}): PushTarget {
  return {
    source: "refs/heads/main",
    destination: "refs/heads/main",
    force: false,
    commit: "a".repeat(40),
    ...overrides,
  };
}

describe("createHttpGitRemote", () => {
  let server: InProcessGitServer;

  beforeEach(async () => {
    server = await createInProcessGitServer();
  });

  it("returns the locally resolved commit, and the server ref really holds it", async () => {
    const { git, ids } = await localRepo([{ "README.md": "hello" }]);
    const remote = createHttpGitRemote(git, { url: server.url, fetchFn: server.fetch });

    const { commit } = await remote.push(["refs/heads/main:refs/heads/main"]);

    // Locally resolved — and the server, the only sound witness, agrees.
    expect(commit).toBe(commitId(ids, 0));
    expect(await serverRefs(server)).toEqual({ "refs/heads/main": commitId(ids, 0) });
  });

  it("accepts a refspec with no destination, pushing to the same name", async () => {
    const { git, ids } = await localRepo([{ "README.md": "hello" }]);
    const remote = createHttpGitRemote(git, { url: server.url, fetchFn: server.fetch });

    expect(await remote.push(["refs/heads/main"])).toEqual({ commit: commitId(ids, 0) });
    expect(await serverRefs(server)).toEqual({ "refs/heads/main": commitId(ids, 0) });
  });

  it("pushes to a differently named remote ref: status is keyed by DESTINATION", async () => {
    // `resolveRefspecs` emits `{refName: remoteRef}`, so `refStatus` is keyed by the
    // refspec's destination while the commit id comes from its source. With
    // source === destination — every other test here — the two are indistinguishable;
    // this is the case that tells them apart.
    const { git, ids } = await localRepo([{ "README.md": "hello" }]);
    const remote = createHttpGitRemote(git, { url: server.url, fetchFn: server.fetch });

    const { commit } = await remote.push(["refs/heads/main:refs/heads/trunk"]);

    expect(commit).toBe(commitId(ids, 0));
    expect(await serverRefs(server)).toEqual({ "refs/heads/trunk": commitId(ids, 0) });
  });

  it("returns the FIRST refspec's commit when several are pushed", async () => {
    const { git, history, ids } = await localRepo([{ "a.txt": "one" }, { "b.txt": "two" }]);
    // `other` lags a commit behind `main`, so "first refspec" is discriminating.
    await history.refs.set("refs/heads/other", commitId(ids, 0));
    const remote = createHttpGitRemote(git, { url: server.url, fetchFn: server.fetch });

    const { commit } = await remote.push([
      "refs/heads/main:refs/heads/main",
      "refs/heads/other:refs/heads/other",
    ]);

    expect(commit).toBe(commitId(ids, 1));
    expect(await serverRefs(server)).toEqual({
      "refs/heads/main": commitId(ids, 1),
      "refs/heads/other": commitId(ids, 0),
    });
  });

  it("sends Authorization: Basic on every request when credentials are given", async () => {
    const { git } = await localRepo([{ "README.md": "hello" }]);
    const remote = createHttpGitRemote(git, {
      url: server.url,
      fetchFn: server.fetch,
      credentials: { username: "alice", password: "s3cret" },
    });

    await remote.push(["refs/heads/main:refs/heads/main"]);

    // Without this assertion an implementation that ignores `credentials`
    // entirely passes every other test here — the in-process server needs no auth.
    const expected = `Basic ${btoa("alice:s3cret")}`;
    expect(server.requests.length).toBeGreaterThan(0);
    expect(server.requests.map((r) => r.authorization)).toEqual(
      server.requests.map(() => expected),
    );
  });

  it("advertises no HEAD: the server's symbolic ref never reaches the wire", async () => {
    // `openGitRepo`'s create path writes `.git/HEAD` as `ref: refs/heads/main`, and
    // the file ref store yields HEAD from `list()` with no `objectId`. `refStoreOf`'s
    // `listAll()` drops it; if it did not, the advertisement would carry
    // `undefined HEAD` and this push could not complete.
    expect(await readText(server.files as MemFilesApi, ".git/HEAD")).toContain("ref: refs/heads/");

    const { git, ids } = await localRepo([{ "README.md": "hello" }]);
    const remote = createHttpGitRemote(git, { url: server.url, fetchFn: server.fetch });
    await remote.push(["refs/heads/main:refs/heads/main"]);

    const refs = await serverRefs(server);
    expect(refs).toEqual({ "refs/heads/main": commitId(ids, 0) });
    expect(Object.keys(refs)).not.toContain("HEAD");
  });

  describe("failure mapping (HTTP)", () => {
    it("1 — throws, carrying the transport's error, when success is false", async () => {
      const { git } = await localRepo([{ "README.md": "hello" }]);
      const remote = createHttpGitRemote(git, {
        url: server.url,
        fetchFn: async () => new Response("nope", { status: 401, statusText: "Unauthorized" }),
      });

      await expect(remote.push(["refs/heads/main:refs/heads/main"])).rejects.toThrow(
        /401|Unauthorized/,
      );
    });

    it("2 — throws when a per-ref entry failed while the overall result says success", () => {
      // Not reachable through today's `httpPush` (`parseReportStatusLines` clears
      // `ok` whenever any ref fails), so the mapping is exercised directly. It is
      // kept because a partial failure that reads as success would be checkpointed
      // by `publish` as a completed push.
      const result: PushResult = {
        success: true,
        refStatus: new Map([["refs/heads/main", { success: false, error: "rejected" }]]),
      };

      expect(() => httpPushOutcome(result, [target()])).toThrow(RemotePushError);
      expect(() => httpPushOutcome(result, [target()])).toThrow(/rejected/);
    });

    it("3 — throws when the transport silently skipped a requested refspec", () => {
      // `resolveRefspecs` SILENTLY SKIPS any refspec whose local ref does not
      // resolve, and `httpPush` still answers `{success: true}` with an empty
      // `refStatus` — a zero-byte push that reads as a success. `pushTargetsOf`
      // now refuses an unresolvable refspec before the wire, and the `+` prefix is
      // stripped before `httpPush` sees it, so no caller input reaches this branch
      // today. Like case 2 it is exercised directly rather than deleted: what makes
      // it worth keeping is that `publish` would checkpoint such a push as done.
      const result: PushResult = { success: true, refStatus: new Map() };

      expect(() => httpPushOutcome(result, [target()])).toThrow(RemotePushError);
      expect(() => httpPushOutcome(result, [target()])).toThrow(/said nothing about/);
    });

    it("throws before the wire when a refspec's local ref does not resolve", async () => {
      const { git } = await localRepo([{ "README.md": "hello" }]);
      const remote = createHttpGitRemote(git, { url: server.url, fetchFn: server.fetch });

      await expect(remote.push(["refs/heads/trunk:refs/heads/trunk"])).rejects.toThrow(
        /refs\/heads\/trunk/,
      );
      // Local resolution precedes the push: the server was never contacted.
      expect(server.requests).toEqual([]);
    });

    it("throws on an empty refspec list rather than inventing a commit", async () => {
      const { git } = await localRepo([{ "README.md": "hello" }]);
      const remote = createHttpGitRemote(git, { url: server.url, fetchFn: server.fetch });

      await expect(remote.push([])).rejects.toThrow(RemotePushError);
      expect(server.requests).toEqual([]);
    });

    it("throws on a deletion refspec — there is no commit to report", async () => {
      const { git } = await localRepo([{ "README.md": "hello" }]);
      const remote = createHttpGitRemote(git, { url: server.url, fetchFn: server.fetch });

      await expect(remote.push([":refs/heads/main"])).rejects.toThrow(RemotePushError);
      expect(server.requests).toEqual([]);
    });

    it("throws on a NEGATIVE refspec instead of pushing the ref it means to exclude", async () => {
      // `parseRefSpec` sets `negative: true` for `^refs/…` and the canonicaliser
      // read only `parsed.force`, so `^refs/heads/main` — which means EXCLUDE —
      // was canonicalised into `refs/heads/main:refs/heads/main` and PUSHED. The
      // exact inverse of what the caller asked for, which is worse than a refusal.
      const { git } = await localRepo([{ "README.md": "hello" }]);
      const remote = createHttpGitRemote(git, { url: server.url, fetchFn: server.fetch });

      await expect(remote.push(["^refs/heads/main"])).rejects.toThrow(RemotePushError);
      await expect(remote.push(["^refs/heads/main"])).rejects.toThrow(/exclude/);
      expect(server.requests).toEqual([]);
      expect(await serverRefs(server)).toEqual({});
    });
  });

  describe("force refspecs", () => {
    it("a '+' refspec LANDS, rather than throwing on a push that never happened", async () => {
      // This is the case the suite used to pin the wrong way round. `+` was passed
      // through to `httpPush`, whose `resolveRefspecs` does not strip it — so the
      // transport looked up a local ref literally named `+refs/heads/main`, found
      // nothing, skipped the refspec, and reported `{success: true}` with an empty
      // `refStatus`; outcome case 3 then threw. Force-push ALWAYS threw and NEVER
      // landed. The `+` is now stripped before HTTP sees it (it is inert on that
      // wire) and kept for the duplex FSM, which reads it.
      const { git, ids } = await localRepo([{ "README.md": "hello" }]);
      const remote = createHttpGitRemote(git, { url: server.url, fetchFn: server.fetch });

      const { commit } = await remote.push(["+refs/heads/main:refs/heads/main"]);

      expect(commit).toBe(commitId(ids, 0));
      expect(await serverRefs(server)).toEqual({ "refs/heads/main": commitId(ids, 0) });
    });

    it("a fast-forward '+' push lands on top of what the server already holds", async () => {
      const { git, history, ids } = await localRepo([{ "a.txt": "one" }, { "b.txt": "two" }]);
      const remote = createHttpGitRemote(git, { url: server.url, fetchFn: server.fetch });

      // Push the parent first — through the wire, so the server holds its objects
      // and can decide ancestry — then `+`-push the child over it. A real ref
      // update, not a no-op against an empty server.
      await history.refs.set("refs/heads/base", commitId(ids, 0));
      await remote.push(["refs/heads/base:refs/heads/main"]);
      expect(await serverRefs(server)).toEqual({ "refs/heads/main": commitId(ids, 0) });

      await remote.push(["+refs/heads/main:refs/heads/main"]);

      expect(await serverRefs(server)).toEqual({ "refs/heads/main": commitId(ids, 1) });
    });

    /**
     * **The limit `+` does NOT lift on this transport, stated as a fact.**
     *
     * A non-fast-forward update is refused by the RECEIVER: `createFetchHandler`'s
     * receive-pack path hard-codes `allowNonFastForward: false`
     * (`transport/src/adapters/http/http-server.ts:389`) and exposes no option for
     * it, and smart HTTP carries no client-side force signal — measured, all three
     * spellings against a divergent server ref:
     *
     *   refspecs: ["refs/heads/main:…"]   -> {success:false, "non-fast-forward"}
     *   refspecs: ["+refs/heads/main:…"]  -> {success:true,  refStatus:{}}  (SKIPPED, nothing written)
     *   force: true + plain refspec       -> {success:false, "non-fast-forward"}
     *
     * So stripping the `+` does not lose force semantics — there were none to
     * lose. What it fixes is the middle line: a `+` push used to be silently
     * skipped and then reported as "the transport said nothing about this ref",
     * whether or not it was a fast-forward. Now it behaves as a push, and a
     * genuine non-fast-forward is refused with the reason the server gave.
     * Lifting the limit is upstream work in `vcs/packages/transport`.
     */
    it("a divergent '+' push is refused with the RECEIVER's reason, not a phantom skip", async () => {
      const other = await localRepo([{ "other.txt": "theirs" }]);
      await createHttpGitRemote(other.git, { url: server.url, fetchFn: server.fetch }).push([
        "refs/heads/main:refs/heads/main",
      ]);
      expect(await serverRefs(server)).toEqual({ "refs/heads/main": commitId(other.ids, 0) });

      const { git } = await localRepo([{ "README.md": "hello" }]);
      const remote = createHttpGitRemote(git, { url: server.url, fetchFn: server.fetch });

      const error = await remote
        .push(["+refs/heads/main:refs/heads/main"])
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RemotePushError);
      // The actionable half: the caller learns WHY, rather than reading that the
      // transport "said nothing about" a ref it never looked at.
      expect((error as Error).message).toContain("non-fast-forward");
      expect((error as Error).message).not.toContain("skipped it");
      // And the server still holds what it held.
      expect(await serverRefs(server)).toEqual({ "refs/heads/main": commitId(other.ids, 0) });
    });

    it("a '+' refspec with no destination lands on the same name", async () => {
      const { git, ids } = await localRepo([{ "README.md": "hello" }]);
      const remote = createHttpGitRemote(git, { url: server.url, fetchFn: server.fetch });

      expect(await remote.push(["+refs/heads/main"])).toEqual({ commit: commitId(ids, 0) });
      expect(await serverRefs(server)).toEqual({ "refs/heads/main": commitId(ids, 0) });
    });

    it("keeps the '+' for the duplex FSM, which reads it, and drops it for HTTP", () => {
      // The two transports differ, so one canonical string cannot serve both:
      // `client-push-fsm.ts` reads the prefix for its local non-fast-forward check,
      // while HTTP's `resolveRefspecs` treats it as part of the ref NAME.
      const forced = target({ force: true });
      expect(duplexRefspecOf(forced)).toBe("+refs/heads/main:refs/heads/main");
      expect(httpRefspecOf(forced)).toBe("refs/heads/main:refs/heads/main");

      const plain = target();
      expect(duplexRefspecOf(plain)).toBe("refs/heads/main:refs/heads/main");
      expect(httpRefspecOf(plain)).toBe("refs/heads/main:refs/heads/main");
    });
  });
});

describe("createDuplexGitRemote", () => {
  it("returns the locally resolved commit, and the served ref really holds it", async () => {
    const { git, ids } = await localRepo([{ "README.md": "hello" }]);
    const server = await createDuplexServer();
    const remote = createDuplexGitRemote(git, { connect: server.connect });

    const { commit } = await remote.push(["refs/heads/main:refs/heads/main"]);

    expect(commit).toBe(commitId(ids, 0));
    expect(await server.refStore.get("refs/heads/main")).toBe(commitId(ids, 0));
  });

  it("accepts a refspec with no destination, pushing to the same name", async () => {
    // The duplex FSM reads `destination ?? ""` (`client-push-fsm.ts:123-160`), so a
    // bare `refs/heads/main` handed through unchanged would be pushed to the ref
    // named `""`. The refspec is canonicalised to `source:destination` first.
    const { git, ids } = await localRepo([{ "README.md": "hello" }]);
    const server = await createDuplexServer();
    const remote = createDuplexGitRemote(git, { connect: server.connect });

    expect(await remote.push(["refs/heads/main"])).toEqual({ commit: commitId(ids, 0) });
    expect(await server.refStore.get("refs/heads/main")).toBe(commitId(ids, 0));
  });

  it("lands a '+' refspec, with the prefix kept — the FSM is what reads it", async () => {
    const { git, ids } = await localRepo([{ "README.md": "hello" }]);
    const server = await createDuplexServer();
    const remote = createDuplexGitRemote(git, { connect: server.connect });

    const { commit } = await remote.push(["+refs/heads/main:refs/heads/main"]);

    expect(commit).toBe(commitId(ids, 0));
    expect(await server.refStore.get("refs/heads/main")).toBe(commitId(ids, 0));
  });

  describe("failure mapping (duplex)", () => {
    it("1 — throws, carrying the transport's error, when success is false", async () => {
      const { git } = await localRepo([{ "README.md": "hello" }]);
      const remote = createDuplexGitRemote(git, { connect: deadDuplex });

      await expect(remote.push(["refs/heads/main:refs/heads/main"])).rejects.toThrow(
        /advertisement|end of stream/i,
      );
    });

    it("2 — throws before connecting when a refspec's local ref does not resolve", async () => {
      // `pushOverDuplex` reports NOTHING per ref — no `refStatus` is ever built — so
      // the pre-push local resolution is the only guard this transport can have.
      const { git } = await localRepo([{ "README.md": "hello" }]);
      const server = await createDuplexServer();
      const remote = createDuplexGitRemote(git, { connect: server.connect });

      await expect(remote.push(["refs/heads/trunk:refs/heads/trunk"])).rejects.toThrow(
        /refs\/heads\/trunk/,
      );
      expect(server.connects).toBe(0);
    });

    it("reads no per-ref status: a bare {success:true} is a success", () => {
      // Pinning the shape, because this is what makes the "no `newOid`" correction
      // necessary: there is no `refStatus` to read a pushed id out of.
      expect(duplexPushOutcome({ success: true }, [target({ commit: "b".repeat(40) })])).toEqual({
        commit: "b".repeat(40),
      });
      expect(() => duplexPushOutcome({ success: false, error: "boom" }, [target()])).toThrow(
        /boom/,
      );
    });
  });
});
