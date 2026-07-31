import type { Git } from "@statewalker/vcs-commands";
import type { Duplex, PushResult, RefStore } from "@statewalker/vcs-transport";
import { httpPush, parseRefSpec, pushOverDuplex } from "@statewalker/vcs-transport";
import type { GitRemote } from "@statewalker/vcs-workspace";
import type { RemoteCredentials } from "../remotes/http-remote.js";
import { refStoreOf } from "./ref-store.js";
import { historyOf, repositoryFacadeOf } from "./repository-facade.js";

/**
 * One refspec, canonicalised, with the commit its **source** ref resolves to
 * **locally, before the push**.
 *
 * The local resolution is the whole design. `GitRemote.push` owes its caller a
 * commit id, and neither transport ever reports one on success:
 *
 * - `httpPush` builds every success entry as the bare literal `{success: true}`
 *   (`transport/src/adapters/http/http-client.ts:521-538`) — `RefPushStatus.newOid`
 *   is populated on no path at all, and only *declared* for failures.
 * - `pushOverDuplex` returns the bare literal `{success: true}` and constructs
 *   **no `refStatus` whatsoever** (`transport/src/operations/push-over-duplex.ts:98-100`).
 *
 * So a rule of the form "succeeded but no `newOid` ⇒ something is wrong" would
 * throw on **every** successful push on **both** transports. The push result is
 * consulted for exactly one thing: did it succeed.
 */
export interface PushTarget {
  /** Local ref, e.g. `refs/heads/main`. */
  source: string;
  /** Remote ref, e.g. `refs/heads/main`. */
  destination: string;
  /** Whether the caller asked for a non-fast-forward update (`+`). */
  force: boolean;
  /** The commit `source` resolved to **before** the push. */
  commit: string;
}

/**
 * The refspec for the **duplex** transport: `[+]<source>:<destination>`.
 *
 * The `+` is kept because `pushOverDuplex`'s FSM reads it for its local
 * non-fast-forward check (`fsm/push/client-push-fsm.ts`).
 */
export function duplexRefspecOf(target: PushTarget): string {
  return `${target.force ? "+" : ""}${target.source}:${target.destination}`;
}

/**
 * The refspec for the **HTTP** transport: `<source>:<destination>`, never a `+`.
 *
 * The prefix is stripped, and that is a fix rather than a simplification.
 * `httpPush`'s `resolveRefspecs` (`http-client.ts:572-608`) does **not** strip it
 * before looking the source ref up, so a `+`-prefixed refspec made it look for a
 * local ref literally named `+refs/heads/main`, find nothing, and **silently skip
 * the refspec** — while still answering `{success: true}` with an empty
 * `refStatus`. Every force-push therefore threw ({@link httpPushOutcome} case 3)
 * and none ever landed.
 *
 * Nothing is lost by dropping it: on the smart-HTTP wire the force decision is
 * carried by the update command itself, not by the refspec text, so `+` is inert
 * there. Whether the server accepts a non-fast-forward update is the server's
 * call either way.
 */
export function httpRefspecOf(target: PushTarget): string {
  return `${target.source}:${target.destination}`;
}

/** Raised when a push did not put the requested refspecs on the remote. */
export class RemotePushError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemotePushError";
  }
}

/**
 * Canonicalise the refspecs and resolve each source ref locally — or throw.
 *
 * Canonicalisation splits `[+]<source>[:<destination>]` into its parts, with the
 * destination defaulted to the source. It is not cosmetic: `pushOverDuplex`'s FSM
 * uses `destination ?? ""` (`fsm/push/client-push-fsm.ts:123-160`), so a bare
 * `refs/heads/main` would be pushed to the ref named `""`. The `+` is carried as
 * a **flag** rather than as text, because the two transports want different
 * spellings of it — {@link duplexRefspecOf} keeps it, {@link httpRefspecOf} drops
 * it, and each says why.
 *
 * Two shapes are refused outright:
 *
 * - **Deletions** (`:refs/heads/x`). `GitRemote.push` must answer with a commit id
 *   and a deletion has none. Refusing is the only shape of that contract that is
 *   not a lie.
 * - **Negative refspecs** (`^refs/heads/x`). They mean *exclude*, and there is
 *   nothing here to exclude them from — this remote pushes exactly what it is
 *   given. Refusing matters because the alternative was measured: reading only
 *   `parsed.force` canonicalised `^refs/heads/main` into
 *   `refs/heads/main:refs/heads/main` and **pushed** it, the exact inverse of the
 *   request.
 */
export async function pushTargetsOf(refspecs: string[], refs: RefStore): Promise<PushTarget[]> {
  if (refspecs.length === 0) {
    throw new RemotePushError("push requires at least one refspec; none were given");
  }

  const targets: PushTarget[] = [];
  for (const spec of refspecs) {
    const parsed = parseRefSpec(spec);
    if (parsed.negative) {
      throw new RemotePushError(
        `refspec '${spec}' is negative: '^' means exclude, and this remote pushes ` +
          "exactly the refspecs it is given. Drop the refspec instead of negating it.",
      );
    }
    if (!parsed.source) {
      throw new RemotePushError(
        `refspec '${spec}' deletes a remote ref; this remote pushes commits only, ` +
          "and a deletion has no commit id to report",
      );
    }
    const source = parsed.source;
    const destination = parsed.destination ?? source;

    const commit = await refs.get(source);
    if (!commit) {
      throw new RemotePushError(
        `refspec '${spec}' does not resolve: no local ref '${source}'. ` +
          "Both transports skip a refspec they cannot resolve and still report success, " +
          "so this is checked before the push rather than after it.",
      );
    }

    targets.push({ source, destination, force: parsed.force, commit });
  }
  return targets;
}

/**
 * `httpPush`'s status-shaped result → the exception-shaped `GitRemote` contract.
 *
 * `httpPush` returns `PushResult {success, error?, refStatus?}`, and `refStatus`
 * is keyed by the refspec **destination** — `resolveRefspecs` emits
 * `{refName: remoteRef}` (`http-client.ts:572-608`). The three failure cases:
 *
 * 1. **`success === false`** — throw, carrying `error`.
 * 2. **A destination's entry reports failure under an overall success** — throw.
 *    Not reachable through today's `httpPush` (`parseReportStatusLines` clears
 *    `ok` whenever any ref fails, and `httpPush` returns `success: ok`), but a
 *    partial failure reading as success is precisely what `publish` would
 *    checkpoint as a completed push, so the guard stays.
 * 3. **A requested destination is absent from `refStatus`** — throw.
 *    `resolveRefspecs` **silently skips** any refspec whose local ref does not
 *    resolve and `httpPush` still answers `{success: true}` with an empty
 *    `refStatus`. No caller input reaches this today — {@link pushTargetsOf}
 *    resolves every source ref before the wire, and {@link httpRefspecOf} strips
 *    the `+` that used to trigger it on every force-push — so, like case 2, it is
 *    a guard against a partial failure that reads as success, which is precisely
 *    what `publish` would checkpoint as a completed push.
 *
 * On success the commit returned is the **first refspec's** — the locally
 * resolved id of its source ref. For a multi-refspec push the other refspecs
 * still land; only one commit id fits `GitRemote.push`'s return type, and the
 * first is the one the caller named first.
 */
export function httpPushOutcome(result: PushResult, targets: PushTarget[]): { commit: string } {
  const [first] = targets;
  if (!first) {
    throw new RemotePushError("push requires at least one refspec; none were given");
  }

  const refStatus = result.refStatus ?? new Map();

  if (!result.success) {
    // `result.error` is the generic "Some refs failed to update"; the reason the
    // caller can act on — `non-fast-forward`, say — is only in `refStatus`. A
    // rejected force-push is exactly this case, so surfacing it is not cosmetic.
    const rejected = [...refStatus]
      .filter(([, status]) => !status.success)
      .map(([name, status]) => `${name}: ${status.error ?? "no reason reported"}`);
    const detail = rejected.length ? rejected.join("; ") : (result.error ?? "no reason reported");
    throw new RemotePushError(`push failed: ${detail}`);
  }
  for (const t of targets) {
    const status = refStatus.get(t.destination);
    if (!status) {
      throw new RemotePushError(
        `push reported success but said nothing about '${t.destination}' ` +
          `(refspec '${httpRefspecOf(t)}'): the transport skipped it and nothing was written.`,
      );
    }
    if (!status.success) {
      throw new RemotePushError(
        `push rejected '${t.destination}' (refspec '${httpRefspecOf(t)}'): ${status.error ?? "no reason reported"}`,
      );
    }
  }

  return { commit: first.commit };
}

/**
 * `pushOverDuplex`'s result → the `GitRemote` contract.
 *
 * A different shape from HTTP's, which is why the tables are split: this one
 * carries `{success, error?}` and **never** a `refStatus`, so there is nothing
 * to check per ref. Only two cases exist —
 *
 * 1. **`success === false`** — throw, carrying `error`.
 * 2. success — return the first target's locally resolved commit.
 *
 * The per-ref guard HTTP gets from case 3 has no counterpart here; its whole job
 * is done up front by {@link pushTargetsOf}, before the transport is contacted.
 */
export function duplexPushOutcome(result: PushResult, targets: PushTarget[]): { commit: string } {
  const [first] = targets;
  if (!first) {
    throw new RemotePushError("push requires at least one refspec; none were given");
  }
  if (!result.success) {
    throw new RemotePushError(`push failed: ${result.error ?? "no reason reported"}`);
  }
  return { commit: first.commit };
}

/** Everything {@link createHttpGitRemote} needs to reach one HTTP(S) repository. */
export interface HttpGitRemoteOptions {
  /** Absolute URL of the remote repository. */
  url: string;
  /**
   * The `fetch` to use. Injected, never read from the environment — the nature's
   * whole dependency story is `registerVcs(workspace, deps)`.
   */
  fetchFn?: typeof fetch;
  /**
   * HTTP Basic credentials. They come from the workspace `Secrets` store and are
   * held only for the duration of a call; nothing here writes them anywhere.
   */
  credentials?: RemoteCredentials;
  /** Extra request headers. */
  headers?: Record<string, string>;
}

/** Everything {@link createDuplexGitRemote} needs to reach one duplex peer. */
export interface DuplexGitRemoteOptions {
  /**
   * Opens a fresh `Duplex` for one push.
   *
   * A connect **function**, not a `Duplex`, because a duplex carries exactly one
   * git session: `pushOverDuplex` drives the advertisement → commands → pack →
   * report-status exchange to completion and leaves the stream spent. A remote
   * that held a single `Duplex` would work once and then fail in a way that looks
   * like a protocol error.
   */
  connect: () => Duplex | Promise<Duplex>;
  /** Ask the server for an all-or-nothing ref update. */
  atomic?: boolean;
}

/**
 * A `vcs-workspace` `GitRemote` that pushes over smart HTTP.
 *
 * **`push` returns the FIRST refspec's commit.** `GitRemote.push` accepts many
 * refspecs and returns one commit id; every refspec is pushed and verified, and
 * the id reported is the first one's.
 *
 * Built on `httpPush` rather than on this package's own `pushToHttpRemote`
 * (`src/remotes/http-remote.ts`): that one wraps the transport's `push()`
 * operation, which pushes a single same-named ref and returns a different result
 * shape (`{ok, updates}`), while `GitRemote.push` takes arbitrary refspecs.
 */
export function createHttpGitRemote(git: Git, options: HttpGitRemoteOptions): GitRemote {
  const refs = refStoreOf(historyOf(git));
  return {
    async push(refspecs: string[]): Promise<{ commit: string }> {
      const targets = await pushTargetsOf(refspecs, refs);
      const result = await httpPush(options.url, repositoryFacadeOf(git), refs, {
        refspecs: targets.map(httpRefspecOf),
        credentials: options.credentials,
        headers: options.headers,
        fetchFn: options.fetchFn,
      });
      return httpPushOutcome(result, targets);
    },
  };
}

/**
 * A `vcs-workspace` `GitRemote` that pushes over any bidirectional byte stream —
 * MessagePort, WebSocket, WebRTC, a webrun channel.
 *
 * Same first-refspec rule as {@link createHttpGitRemote}, and the same local
 * commit resolution; what differs is the failure table, because this transport
 * reports no per-ref status at all.
 */
export function createDuplexGitRemote(git: Git, options: DuplexGitRemoteOptions): GitRemote {
  const refs = refStoreOf(historyOf(git));
  return {
    async push(refspecs: string[]): Promise<{ commit: string }> {
      // Before `connect()`: an unresolvable refspec must not open a session, and
      // it is the only failure this transport can be asked about in advance.
      const targets = await pushTargetsOf(refspecs, refs);
      const result = await pushOverDuplex({
        duplex: await options.connect(),
        repository: repositoryFacadeOf(git),
        refStore: refs,
        refspecs: targets.map(duplexRefspecOf),
        atomic: options.atomic,
      });
      return duplexPushOutcome(result, targets);
    },
  };
}
