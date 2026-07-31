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
 * **`fileRemotes` is intentionally empty.** GitNature ships no file remote; Axis A
 * is out of its scope. The consequence is asserted rather than ignored: no `scan`
 * or `transfer` event is emitted and the checkpoint's `fileRemotes` is `{}`.
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
    // Axis A does nothing — which is the whole shape of this feature.
    expect(events.map((e) => e.type)).toEqual(["commit", "push", "checkpoint"]);

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

    const second = await run(h, {
      commitAfterSync: true,
      pushAfterCommit: true,
      commitOnlyWhenChanged: true,
    });

    // `hasChanges()` is `commitOnlyWhenChanged`'s only input, and both shipped
    // status sources answer it wrongly in opposite directions (E5) — a `false`
    // here is what proves the adapter's own content-hash diff is the one running.
    // No commit means no `commit` id in scope, so step 4 pushes nothing either:
    // `publish` gates the push on a commit from THIS run, not on HEAD.
    expect(second.map((e) => e.type)).toEqual(["skipped", "checkpoint"]);
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

    const checkpoint = checkpointOf(events);
    expect(await serverRefs(h.server)).toEqual({ "refs/heads/trunk": checkpoint.commit });
    // The commit id is the SOURCE ref's, while the transport keys its per-ref
    // status by the DESTINATION; with the two names equal — every other test here
    // — those are indistinguishable.
    expect(checkpoint.historyRemotes.origin).toBe(checkpoint.commit);
  });

  it("re-publishes an edit as a second commit the server ends up holding", async () => {
    const h = await harnessOf();

    const first = checkpointOf(await run(h, { commitAfterSync: true, pushAfterCommit: true }));
    await files.write("/a/src/deep/nested.txt", [encoder.encode("edited")]);
    const second = checkpointOf(await run(h, { commitAfterSync: true, pushAfterCommit: true }));

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
    expect(events.map((e) => e.type)).toContain("push");
    expect(Object.keys(await serverRefs(h.server))).toEqual([DEFAULT_REFSPEC.split(":")[1]]);
  });
});
