import type { History, RefEntry, Refs } from "@statewalker/vcs-core";
import { RefStorage } from "@statewalker/vcs-core";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { refStoreOf } from "../../src/adapters/ref-store.js";
import { historyOf, repositoryFacadeOf } from "../../src/adapters/repository-facade.js";
import { openGitRepo } from "../../src/runtime/git-assembly.js";

const MAIN = "1111111111111111111111111111111111111111";
const FEATURE = "2222222222222222222222222222222222222222";

/**
 * A `History` whose `refs.list()` yields exactly `entries`.
 *
 * A stub rather than a real store because the shape under test — a symbolic ref
 * that also carries an `objectId` — is one the file-backed store never produces,
 * and it is precisely the shape that separates `listAll()`'s two guard clauses.
 * Only `list()` is implemented; every other member would be a `TypeError` if the
 * adapter reached for it, which is the point.
 */
function refsYielding(entries: RefEntry[]): History {
  const refs = {
    async *list(): AsyncIterable<RefEntry> {
      for (const entry of entries) yield entry;
    },
  } as unknown as Refs;
  return { refs } as unknown as History;
}

describe("refStoreOf", () => {
  let history: History;

  beforeEach(async () => {
    const files = new MemFilesApi();
    history = historyOf(await openGitRepo(files, { create: true }));
    await history.refs.set("refs/heads/main", MAIN);
    await history.refs.set("refs/heads/feature", FEATURE);
  });

  it("omits symbolic refs from listAll()", async () => {
    // `.git/HEAD` is written by the create path as `ref: refs/heads/main`, and the
    // file ref store yields HEAD from `list()` with **no `objectId`**. Advertising it
    // would put `undefined refs/HEAD` on the wire — so `listAll()`, whose contract is
    // `[name, oid]` pairs, has to drop it. This is the whole reason a hand-rolled
    // adapter is needed rather than passing `history.refs` through.
    const listed = [...(await refStoreOf(history).listAll())];

    expect(Object.fromEntries(listed)).toEqual({
      "refs/heads/main": MAIN,
      "refs/heads/feature": FEATURE,
    });
    expect(listed.map(([name]) => name)).not.toContain("HEAD");
    expect(listed.every(([, oid]) => typeof oid === "string" && oid.length === 40)).toBe(true);
  });

  /**
   * The case that actually pins the symbolic-ref guard.
   *
   * The test above does **not**: `.git/HEAD` comes back from the file ref store
   * with **no `objectId`**, so `listAll()`'s second clause — `!ref.objectId` —
   * satisfies it on its own. Measured: deleting `isSymbolicRef(ref) ||` from
   * `ref-store.ts:38` left the whole package at **145/145 passing**. The guard
   * that the source calls "the whole reason a hand-rolled adapter is needed" was
   * entirely unverified.
   *
   * `RefEntry` is `Ref | SymbolicRef` and `isSymbolicRef` is a *structural* test
   * for `target`, so a `Refs` that yields a **resolved** symbolic ref — carrying
   * both `target` and `objectId` — is a legal shape of that union and the one
   * that tells the two clauses apart. It is also the shape that matters: without
   * the guard, the in-process server this adapter backs would advertise `HEAD`
   * as an ordinary ref to its peers, which no real git server does.
   */
  it("drops a symbolic ref even when it carries an objectId", async () => {
    const refs = refsYielding([
      { name: "refs/heads/main", objectId: MAIN, storage: RefStorage.LOOSE, peeled: false },
      // Resolved symref: `!ref.objectId` is FALSE here, so only `isSymbolicRef`
      // can drop it.
      {
        name: "HEAD",
        target: "refs/heads/main",
        objectId: MAIN,
        storage: RefStorage.LOOSE,
        peeled: false,
      } as unknown as RefEntry,
    ]);

    const listed = [...(await refStoreOf(refs).listAll())];

    expect(listed).toEqual([["refs/heads/main", MAIN]]);
    expect(listed.map(([name]) => name)).not.toContain("HEAD");
  });

  it("surfaces HEAD's target through getSymrefTarget, and nothing else's", async () => {
    const store = refStoreOf(history);
    expect(await store.getSymrefTarget?.("HEAD")).toBe("refs/heads/main");
    expect(await store.getSymrefTarget?.("refs/heads/main")).toBeUndefined();
  });

  it("resolves through symbolic refs on get(), and updates write through", async () => {
    const store = refStoreOf(history);
    expect(await store.get("HEAD")).toBe(MAIN);
    expect(await store.get("refs/heads/nope")).toBeUndefined();

    await store.update("refs/heads/main", FEATURE);
    expect((await history.refs.resolve("refs/heads/main"))?.objectId).toBe(FEATURE);
  });

  it("recognises ref tips", async () => {
    const store = refStoreOf(history);
    expect(await store.isRefTip?.(MAIN)).toBe(true);
    expect(await store.isRefTip?.("3".repeat(40))).toBe(false);
  });
});

describe("repositoryFacadeOf", () => {
  it("builds a facade over a plain History — which carries no serialization of its own", async () => {
    const files = new MemFilesApi();
    const git = await openGitRepo(files, { create: true });

    // `createGitFilesBackend` returns a plain `History`; only `HistoryWithOperations`
    // has a `serialization` member. The facade recipe supplies one.
    expect((git.history as unknown as { serialization?: unknown }).serialization).toBeUndefined();

    const facade = repositoryFacadeOf(git);
    const blobId = await historyOf(git).blobs.store([new TextEncoder().encode("hi")]);
    expect(await facade.has(blobId)).toBe(true);
    expect(await facade.has("0".repeat(40))).toBe(false);
  });
});

describe("refStoreOf — listAll() advertises no remote-tracking refs", () => {
  it("drops refs/remotes/**, which are local bookkeeping about another machine", async () => {
    // This store is the SERVER side of an exchange. `refs/remotes/origin/main` is a
    // private record of what some other machine had; real git servers advertise no
    // such thing, and doing so leaks the local remote topology to every peer.
    const files = new MemFilesApi();
    const git = await openGitRepo(files, { create: true });
    const history = git.history;
    if (!history) throw new Error("no history");
    await history.refs.set("refs/heads/main", "a".repeat(40));
    await history.refs.set("refs/remotes/origin/main", "b".repeat(40));
    await history.refs.set("refs/tags/v1", "c".repeat(40));

    const advertised = [...(await refStoreOf(history).listAll())].map(([name]) => name);

    expect(advertised).toContain("refs/heads/main");
    expect(advertised).toContain("refs/tags/v1");
    expect(advertised.filter((name) => name.startsWith("refs/remotes/"))).toEqual([]);
  });
});
