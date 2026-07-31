import type { History } from "@statewalker/vcs-core";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { beforeEach, describe, expect, it } from "vitest";
import { refStoreOf } from "../../src/adapters/ref-store.js";
import { historyOf, repositoryFacadeOf } from "../../src/adapters/repository-facade.js";
import { openGitRepo } from "../../src/runtime/git-assembly.js";

const MAIN = "1111111111111111111111111111111111111111";
const FEATURE = "2222222222222222222222222222222222222222";

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
