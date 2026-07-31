/**
 * End-to-end `publish()` — the test the adapters exist for.
 *
 * `@statewalker/vcs-workspace` orchestrates the two axes through the STRUCTURAL
 * `Repository` / `GitRemote` interfaces and imports no engine, so until now its
 * only implementations anywhere were test fakes. This suite drives the real
 * `publish` over this package's real adapters — a file-backed `.git` on a
 * workbench project (`createGitRepository`) pushing to a real smart-HTTP server
 * (`createHttpGitRemote`) — and asserts commit, push and checkpoint against the
 * SERVER, never against the push result.
 *
 * **`commitAfterSync` is enabled here and NOWHERE else.** `VcsNature` never sets
 * it: GitNature commits manually, on an explicit user call, and that boundary is
 * the lock the whole feature is built around. A test is allowed to reach past it
 * because a test is not the product; if this flag ever appears under `src/`, that
 * lock is broken.
 *
 * Four invocation facts this suite is shaped by — each one makes the test
 * vacuous or throwing when got wrong:
 *
 * 1. `WorkspaceRemotes` has BOTH `fileRemotes` AND `historyRemotes`, both
 *    REQUIRED and both `Map`s. `publish` iterates `remotes.fileRemotes` unguarded
 *    (`publish.ts:41`), so an object literal — or a missing field — throws
 *    `TypeError: … is not iterable` before any commit or push happens.
 * 2. `publish(ws, remotes, policy, opts)` takes FOUR arguments and is an ASYNC
 *    GENERATOR. Calling it runs nothing; it must be drained with `for await`, or
 *    the test passes having executed no code at all.
 * 3. `opts.hashContent` is REQUIRED and no shipped package exports one — hence
 *    this package's {@link hashContentSha256}.
 * 4. `publish` NEVER calls `repository.manifest()`. It computes its own id as
 *    `manifestOf(ws.workingTree, hashContent)` (`publish.ts:35`). The manifest
 *    assertion therefore means something ONLY when `ws.workingTree` is
 *    `trackedFilesOf(repoFilesOf(project))` — the same `.git`-excluding view the
 *    `Repository` adapter measures — hashed with the same function instance.
 *    `"the raw project view can never agree"` below is the test that keeps that
 *    from being an accident.
 *
 * 5. `publish` **SWALLOWS every push exception** (`publish.ts:89-105`): a thrown
 *    `RemotePushError` becomes `yield {type: "failed", …}`, then a checkpoint,
 *    then `return`. **Nothing rejects**, so `rejects.toThrow` can assert nothing
 *    about this feature, and a completely failed push still ends in a checkpoint
 *    that reads like a completed run.
 * 6. The push loop is gated on a commit from THIS run (`publish.ts:82`:
 *    `if (policy.pushAfterCommit && commit)`). With no commit it does not run and
 *    emits **no event at all — not even a `skipped`**. So "no failure occurred"
 *    is satisfied by a run that pushed absolutely nothing.
 *
 * (5) and (6) compose into the trap this suite must not fall into: awaiting the
 * drain and finding no exception proves NOTHING. Every successful-path test here
 * therefore goes through {@link expectPublished}, which asserts the **absence of
 * any `failed` event** and the **presence of** a `commit` and a `push` event.
 * `"a failed push does not reject"` and `"emits nothing for the push step"` pin
 * both hazards as real behaviours rather than hypotheses.
 *
 * **`fileRemotes` is intentionally empty.** GitNature ships no file remote; Axis A
 * is out of its scope. The consequence is asserted rather than ignored: no `scan`
 * or `transfer` event is emitted and the checkpoint's `fileRemotes` is `{}`.
 *
 * **`remote.objects` is never exercised.** Step 3 runs only when
 * `ws.largeObjects && opts.largeObjects?.length` (`publish.ts:70`), and this
 * package's `GitRemote` leaves `objects` undefined. No `upload` event can occur.
 */

import type { Git } from "@statewalker/vcs-commands";
import {
  manifestOf,
  publish,
  type Workspace as VcsWorkspace,
  type WorkspaceCheckpoint,
  type WorkspaceEvent,
  type WorkspaceRemotes,
} from "@statewalker/vcs-workspace";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { type Project, Workspace } from "@statewalker/workspace.core";
import { beforeEach, describe, expect, it } from "vitest";
import { createHttpGitRemote } from "../../src/adapters/git-remote.js";
import { createGitRepository, trackedFilesOf } from "../../src/adapters/repository.js";
import { repoFilesOf } from "../../src/runtime/repo-files.js";
import { registerVcs, vcsNatureOf } from "../../src/runtime/vcs-nature.js";
import { hashContentSha256 } from "../../src/util/hash-content.js";
import {
  createInProcessGitServer,
  type InProcessGitServer,
  serverRefs,
} from "../helpers/in-process-git-server.js";

const encoder = new TextEncoder();

/** The refspec `publish` uses when `opts.refspecs` is absent. */
const DEFAULT_REFSPEC = "refs/heads/main:refs/heads/main";

/** Everything one end-to-end run needs, wired from ONE files view and ONE hash. */
interface Harness {
  project: Project;
  git: Git;
  ws: VcsWorkspace;
  remotes: WorkspaceRemotes;
  server: InProcessGitServer;
}

/** The single `checkpoint` event a successful run ends with, or a loud failure. */
function checkpointOf(events: WorkspaceEvent[]): WorkspaceCheckpoint {
  const found = events.filter((e) => e.type === "checkpoint");
  if (found.length !== 1) {
    throw new Error(`expected exactly one checkpoint event, got ${found.length}`);
  }
  const [only] = found;
  if (only?.type !== "checkpoint") throw new Error("no checkpoint event");
  return only.checkpoint;
}

/**
 * The guard every successful-path test in this suite runs: this drained stream
 * really committed and really pushed, and nothing in it failed.
 *
 * Both halves are load-bearing, and neither is implied by the `await` returning.
 *
 * - **No `failed` event.** `publish` catches every push exception and turns it
 *   into `{type: "failed"}` + a checkpoint + `return` (`publish.ts:89-105`). A
 *   push that threw is therefore indistinguishable from a push that worked if
 *   you only look at whether the drain rejected — it never does.
 * - **A `commit` and a `push` event are PRESENT.** Step 4 is gated on a commit
 *   from this run (`publish.ts:82`), so with `commitAfterSync` off, without a
 *   `ws.repository`, or after a `commitOnlyWhenChanged` skip, the push loop is
 *   **silent** — no `push`, no `skipped`, no `failed`, just a checkpoint. A test
 *   asserting only "nothing failed" would pass over exactly that.
 *
 * Kept separate from {@link checkpointOf} so the two failure-path tests can still
 * extract their checkpoint without tripping this guard.
 */
function expectPublished(events: WorkspaceEvent[]): void {
  expect(events.filter((e) => e.type === "failed")).toEqual([]);
  expect(events.filter((e) => e.type === "commit")).toHaveLength(1);
  expect(events.filter((e) => e.type === "push")).toHaveLength(1);
}

describe("publish() end-to-end over the real adapters", () => {
  let files: MemFilesApi;
  let workspace: Workspace;
  let server: InProcessGitServer;

  beforeEach(async () => {
    files = new MemFilesApi({
      initialFiles: {
        "a/README.md": "hello",
        "a/src/deep/nested.txt": "nested",
      },
    });
    server = await createInProcessGitServer();
    workspace = new Workspace().setFileSystem(files);
    registerVcs(workspace, { fetch: server.fetch as never });
  });

  async function harnessOf(name = "a"): Promise<Harness> {
    const project = await workspace.getProject(name);
    if (!project) throw new Error(`no project: ${name}`);

    const nature = vcsNatureOf(project);
    await nature.init();
    const git = await nature.git();

    // ONE files view and ONE hash instance feed both `ws.workingTree` (what
    // `publish` measures) and `createGitRepository` (what `manifest()` measures).
    // Wire them separately and the manifest assertion below cannot fail, which
    // means it cannot pass either.
    const projectFiles = repoFilesOf(project);
    const workingTree = trackedFilesOf(projectFiles);
    const repository = createGitRepository(git, projectFiles, hashContentSha256);

    return {
      project,
      git,
      ws: { workingTree, repository },
      remotes: {
        fileRemotes: new Map(),
        historyRemotes: new Map([
          ["origin", createHttpGitRemote(git, { url: server.url, fetchFn: server.fetch })],
        ]),
      },
      server,
    };
  }

  /** Drain the async generator — calling `publish` without this executes nothing. */
  async function run(
    h: Harness,
    policy: Parameters<typeof publish>[2],
    opts: Partial<Parameters<typeof publish>[3]> = {},
  ): Promise<WorkspaceEvent[]> {
    const events: WorkspaceEvent[] = [];
    for await (const event of publish(h.ws, h.remotes, policy, {
      hashContent: hashContentSha256,
      ...opts,
    })) {
      events.push(event);
    }
    return events;
  }

  it("commits, pushes, and records a checkpoint tying the manifest to the commit", async () => {
    const h = await harnessOf();

    const events = await run(
      h,
      { commitAfterSync: true, pushAfterCommit: true },
      {
        message: "publish it",
      },
    );

    // The full emitted sequence. No `scan`/`transfer`: `fileRemotes` is empty, so
    // Axis A does nothing — which is the whole shape of this feature. Asserting
    // the WHOLE sequence with `toEqual` is what makes a swallowed push failure
    // visible: a `failed` event would appear in this array.
    expect(events.map((e) => e.type)).toEqual(["commit", "push", "checkpoint"]);
    expectPublished(events);

    const commitEvent = events[0];
    if (commitEvent?.type !== "commit") throw new Error("first event is not a commit");
    expect(commitEvent.changed).toBe(true);
    expect(commitEvent.commit).toMatch(/^[0-9a-f]{40}$/);

    const pushEvent = events[1];
    if (pushEvent?.type !== "push") throw new Error("second event is not a push");
    expect(pushEvent).toEqual({
      type: "push",
      remote: "origin",
      commit: commitEvent.commit,
    });

    // The SERVER is the only sound witness that a push happened. Neither transport
    // reports an object id on success, so a test that read the commit back out of
    // the push result would be asserting against a value this package computed
    // locally — it would pass over a push that never left the process.
    expect(await serverRefs(h.server)).toEqual({ "refs/heads/main": commitEvent.commit });

    const checkpoint = checkpointOf(events);
    expect(checkpoint.commit).toBe(commitEvent.commit);
    expect(checkpoint.historyRemotes).toEqual({ origin: commitEvent.commit });
    // Intentionally empty: this feature ships no file remote.
    expect(checkpoint.fileRemotes).toEqual({});
    expect(checkpoint.id).toBe(checkpoint.workingTreeManifest);
    expect(Number.isNaN(Date.parse(checkpoint.createdAt))).toBe(false);

    // E6, the assertion this whole harness is arranged for: the id `publish`
    // computed from `ws.workingTree` is the id the repository reports. It holds
    // only because both sides saw the `.git`-excluding view and the same hash —
    // and it holds AFTER the commit because `.git` is outside that view.
    expect(checkpoint.workingTreeManifest).toBe(await h.ws.repository?.manifest());
  });

  it("the raw project view can never agree — the trap E6 names", async () => {
    const h = await harnessOf();

    const events = await run(h, { commitAfterSync: true, pushAfterCommit: true });
    expectPublished(events);
    const checkpoint = checkpointOf(events);

    // Both measured at the SAME instant, after the commit. Read as a pair they are
    // the discriminating statement — one view agrees with the recorded id and the
    // other cannot. Asserting only the inequality would pass even when
    // `ws.workingTree` IS the raw view, because the commit moves `.git` between
    // `publish`'s measurement and this one.
    expect(await manifestOf(trackedFilesOf(repoFilesOf(h.project)), hashContentSha256)).toBe(
      checkpoint.workingTreeManifest,
    );
    // Handed the unfiltered view, `manifestOf` folds `.git/index`, `.git/HEAD` and
    // `.git/objects/**` into the id. Passing THAT as `ws.workingTree` would make
    // the checkpoint manifest un-re-derivable from the files alone and the
    // assertion above pure noise.
    expect(await manifestOf(repoFilesOf(h.project), hashContentSha256)).not.toBe(
      checkpoint.workingTreeManifest,
    );
  });

  it("skips the commit under commitOnlyWhenChanged when the tree is clean", async () => {
    const h = await harnessOf();

    const first = await run(h, {
      commitAfterSync: true,
      pushAfterCommit: true,
      commitOnlyWhenChanged: true,
    });
    expect(first.map((e) => e.type)).toEqual(["commit", "push", "checkpoint"]);
    expectPublished(first);

    const second = await run(h, {
      commitAfterSync: true,
      pushAfterCommit: true,
      commitOnlyWhenChanged: true,
    });

    // `hasChanges()` is `commitOnlyWhenChanged`'s only input, and both shipped
    // status sources answer it wrongly in opposite directions (E5) — a `false`
    // here is what proves the adapter's own content-hash diff is the one running.
    //
    // Note WHAT IS NOT HERE: the skipped commit takes the push down with it, and
    // silently. Step 4 is gated on a commit from this run (`publish.ts:82`), so
    // there is no `push` event AND no `skipped: push:origin` either — a
    // `commitOnlyWhenChanged` run over a clean tree contacts no remote at all.
    // That silence is exactly why `expectPublished` demands a POSITIVE `push`.
    expect(second.map((e) => e.type)).toEqual(["skipped", "checkpoint"]);
    expect(second.filter((e) => e.type === "failed")).toEqual([]);
    const skipped = second[0];
    if (skipped?.type !== "skipped") throw new Error("first event is not a skip");
    expect(skipped.step).toBe("commit");

    // The server still holds the first run's commit; nothing regressed.
    const firstCheckpoint = checkpointOf(first);
    expect(await serverRefs(h.server)).toEqual({
      "refs/heads/main": firstCheckpoint.commit,
    });

    // …and the second checkpoint records no commit and no push, because this run
    // made neither. Only the manifest is re-measured.
    const secondCheckpoint = checkpointOf(second);
    expect(secondCheckpoint.commit).toBeUndefined();
    expect(secondCheckpoint.historyRemotes).toEqual({});
    expect(secondCheckpoint.workingTreeManifest).toBe(firstCheckpoint.workingTreeManifest);
  });

  it("pushes the refspecs it is given, and the server ref is the one named", async () => {
    const h = await harnessOf();

    const events = await run(
      h,
      { commitAfterSync: true, pushAfterCommit: true },
      {
        refspecs: ["refs/heads/main:refs/heads/trunk"],
      },
    );

    expect(events.map((e) => e.type)).toEqual(["commit", "push", "checkpoint"]);
    expectPublished(events);

    const checkpoint = checkpointOf(events);
    expect(await serverRefs(h.server)).toEqual({ "refs/heads/trunk": checkpoint.commit });
    // The commit id is the SOURCE ref's, while the transport keys its per-ref
    // status by the DESTINATION; with the two names equal — every other test here
    // — those are indistinguishable.
    expect(checkpoint.historyRemotes.origin).toBe(checkpoint.commit);
  });

  it("re-publishes an edit as a second commit the server ends up holding", async () => {
    const h = await harnessOf();

    const firstEvents = await run(h, { commitAfterSync: true, pushAfterCommit: true });
    expectPublished(firstEvents);
    const first = checkpointOf(firstEvents);

    await files.write("/a/src/deep/nested.txt", [encoder.encode("edited")]);

    const secondEvents = await run(h, { commitAfterSync: true, pushAfterCommit: true });
    // The second run must push for real too — a swallowed failure here would
    // leave the server on the first commit while the checkpoint still recorded
    // a new one, and only the `push`-present check separates those.
    expectPublished(secondEvents);
    const second = checkpointOf(secondEvents);

    expect(second.commit).not.toBe(first.commit);
    // A nested edit moves the manifest only because `buildAnchor` lists
    // recursively — the `{recursive}` option D1 added to `FilesApi.list`.
    expect(second.workingTreeManifest).not.toBe(first.workingTreeManifest);
    expect(await serverRefs(h.server)).toEqual({ "refs/heads/main": second.commit });
    expect(second.historyRemotes).toEqual({ origin: second.commit });
  });

  it("throws nothing on the default refspec: the branch openGitRepo creates is main", async () => {
    const h = await harnessOf();

    const events = await run(h, { commitAfterSync: true, pushAfterCommit: true });

    // `publish`'s default refspec is a hardcoded `refs/heads/main:refs/heads/main`
    // and `pushTargetsOf` refuses a source ref that does not resolve. The two agree
    // only because `openGitRepo` hardcodes the same branch — a coupling nothing
    // else in this package would catch if either side moved.
    //
    // And the disagreement would be SILENT: `pushTargetsOf` would throw, `publish`
    // would swallow it into a `failed` event, and the run would still end in a
    // checkpoint. Hence the exact sequence rather than `toContain("push")`.
    expect(events.map((e) => e.type)).toEqual(["commit", "push", "checkpoint"]);
    expectPublished(events);
    expect(Object.keys(await serverRefs(h.server))).toEqual([DEFAULT_REFSPEC.split(":")[1]]);
  });

  it("a failed push does not reject — it becomes a `failed` event", async () => {
    const h = await harnessOf();

    // `pushTargetsOf` throws `RemotePushError` for a source ref that does not
    // resolve, before contacting the server. That is a real, reachable failure.
    const events = await run(
      h,
      { commitAfterSync: true, pushAfterCommit: true },
      { refspecs: ["refs/heads/nope:refs/heads/nope"] },
    );

    // NOTHING REJECTED. `publish` catches the exception (`publish.ts:89-105`) and
    // turns it into an event, so `await`-ing the drain proves nothing about
    // whether the push worked, and `rejects.toThrow` could never be used here.
    // This is the run every successful-path assertion in this file must be able
    // to tell itself apart from.
    expect(events.map((e) => e.type)).toEqual(["commit", "failed", "checkpoint"]);
    const failed = events[1];
    if (failed?.type !== "failed") throw new Error("second event is not a failure");
    expect(failed.step).toBe("push:origin");
    expect(failed.reason).toMatch(/does not resolve/);

    // The commit is local-only: nothing reached the server.
    expect(await serverRefs(h.server)).toEqual({});

    // The trailing checkpoint is a RESUMABLE PROGRESS RECORD, not a success — it
    // carries the commit that was made and an empty `historyRemotes`. Read as
    // "a checkpoint was emitted, therefore it worked", it is a false green.
    const checkpoint = checkpointOf(events);
    expect(checkpoint.commit).toBe(await h.ws.repository?.head());
    expect(checkpoint.historyRemotes).toEqual({});
  });

  it("emits NOTHING for the push step when this run made no commit", async () => {
    const h = await harnessOf();

    // `pushAfterCommit` is ON. The push loop still does not run, because step 4 is
    // gated on a commit from THIS run (`publish.ts:82`: `pushAfterCommit && commit`).
    const events = await run(h, { commitAfterSync: false, pushAfterCommit: true });

    // No `push`, no `skipped`, no `failed` — total silence, and a checkpoint that
    // looks exactly like a clean run. This is the vacuous pass `expectPublished`
    // exists to make impossible: everything a "nothing went wrong" test checks is
    // true here, and absolutely nothing was pushed.
    expect(events.map((e) => e.type)).toEqual(["checkpoint"]);
    expect(await serverRefs(h.server)).toEqual({});

    const checkpoint = checkpointOf(events);
    expect(checkpoint.commit).toBeUndefined();
    expect(checkpoint.historyRemotes).toEqual({});
    // The manifest is still measured, so the checkpoint is a real file-state record.
    expect(checkpoint.workingTreeManifest).toBe(await h.ws.repository?.manifest());
  });
});
