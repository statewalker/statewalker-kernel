import type { Git } from "@statewalker/vcs-commands";
import type {
  Duplex,
  PushClientResult,
  PushRefUpdate,
  PushResult,
  RefStore,
} from "@statewalker/vcs-transport";
import {
  createTransportRefStore,
  isPushSuccess,
  parseRefSpec,
  pushOverDuplex,
  push as transportPush,
} from "@statewalker/vcs-transport";
import type { GitRemote } from "@statewalker/vcs-workspace";
import { fetchImplOf, type RemoteCredentials } from "../remotes/http-remote.js";
import { historyOf, repositoryFacadeOf } from "./repository-facade.js";

/**
 * One refspec, canonicalised, with the commit its **source** ref resolves to
 * **locally, before the push**.
 *
 * The local resolution is the whole design. `GitRemote.push` owes its caller a
 * commit id, and the transport's per-ref `newOid` is not one it can vouch for: it is
 * the value the push client read from the local ref when it built the update — a
 * read that happens *after* this one, across at least one network round trip — not
 * a confirmation of what the server stored. Reporting the id resolved here, and
 * checking afterwards that the ref did not move ({@link assertNoRefDrift}), is what
 * makes the reported id the pushed one. The push result is consulted for whether
 * each requested ref succeeded, and why not.
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
 * The refspec handed to the transport: `[+]<source>:<destination>`.
 *
 * Both transports run the same push client, which decides each ref as `git push`
 * does before anything is sent: an update that is not a fast-forward — or whose
 * remote value is not even present locally — is refused there (`rejected-*`) unless
 * the refspec carries a `+`. So the `+` is the per-ref force signal and must be kept:
 * with it the update is sent, and whether a non-fast-forward lands is then the
 * **receiver's** call, reported with the receiver's reason.
 */
export function pushRefspecOf(target: PushTarget): string {
  return `${target.force ? "+" : ""}${target.source}:${target.destination}`;
}

/** The refspec for the duplex transport — {@link pushRefspecOf}. */
export const duplexRefspecOf: (target: PushTarget) => string = pushRefspecOf;

/**
 * The refspec for the HTTP transport — {@link pushRefspecOf}, `+` included.
 *
 * It used to drop the `+`: the old HTTP client looked a `+`-prefixed source up as a
 * ref literally named `+refs/heads/main` and skipped it. The current client parses
 * the prefix, and needs it to send a forced update at all.
 */
export const httpRefspecOf: (target: PushTarget) => string = pushRefspecOf;

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
 * destination defaulted to the source, so the transport always receives an
 * explicit `source:destination` and {@link assertNoRefDrift} and the outcome
 * mapping know which remote ref to look for. The `+` is carried as
 * a **flag** rather than as text and spelled back by {@link pushRefspecOf}.
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
          "It is checked here, before any connection is opened, because the commit " +
          "this remote reports is the one resolved now.",
      );
    }

    targets.push({ source, destination, force: parsed.force, commit });
  }
  return targets;
}

/**
 * Re-resolve every target's source ref and throw if it moved — call after the
 * transport returns, before reporting a commit.
 *
 * {@link pushTargetsOf} resolves the source ref **before** the transport runs and
 * the push client **re-reads** it (after the remote's advertisement) when it builds
 * the update, so a single `await` in
 * that window is enough for the reported id and the pushed id to differ. Any real
 * network opens that window on every push, and `publish` writes whatever is reported
 * into `historyRemotes` — so a stale id becomes a checkpoint claiming a commit the
 * remote does not have, and a resume that skips a push it never performed.
 *
 * It throws rather than reporting the re-resolved value. The later read is no more
 * trustworthy than the earlier one — the ref can move again between the transport's
 * read and this one — so re-reporting would swap a detectable lie for an undetectable
 * one. Equal before and after is the only state in which the reported id is known to
 * be what the transport sent. The push itself may well have landed; the caller is
 * told exactly that, and a retry converges.
 */
export async function assertNoRefDrift(targets: PushTarget[], refs: RefStore): Promise<void> {
  for (const t of targets) {
    const now = await refs.get(t.source);
    if (now !== t.commit) {
      throw new RemotePushError(
        `push: local ref '${t.source}' moved while the push was in flight — it was ` +
          `${t.commit} when the push started and is ${now ?? "(gone)"} now. The transport ` +
          "re-reads the ref when it builds its update, so what landed on the remote cannot " +
          "be named with certainty. The push may well have succeeded; retry to find out.",
      );
    }
  }
}

/** One remote ref's verdict, in the form both transports' results can be read into. */
interface RefVerdict {
  success: boolean;
  /** Why it failed: the receiver's reason, or git's status column for a local refusal. */
  reason?: string;
}

/** A push-client ref update → its verdict. */
function verdictOf(update: PushRefUpdate): RefVerdict {
  const success = isPushSuccess(update.status);
  // `message` is the receiver's reason (`remote-rejected`); a refusal decided before
  // the wire has none, and the summary (`[rejected] (fetch first)`) names it.
  return success ? { success } : { success, reason: update.message ?? update.summary };
}

/**
 * The shared failure table. Verdicts are keyed by the **destination** (remote) ref.
 *
 * 1. **The push failed overall** — throw, carrying every refused ref's reason (the
 *    part the caller can act on, `non-fast-forward` say), else `fallback`.
 * 2. **A destination's verdict is a failure under an overall success** — throw. The
 *    transport clears `ok` whenever a ref fails, so this is not reachable today, but
 *    a partial failure reading as success is precisely what `publish` would
 *    checkpoint as a completed push, so the guard stays.
 * 3. **A requested destination has no verdict** — throw. The push client maps every
 *    refspec or throws, and {@link pushTargetsOf} resolves every source first, so no
 *    caller input reaches this today either; like case 2 it guards against a push
 *    that did nothing and reads as success.
 *
 * Without `verdicts` (a result that carries none) only case 1 applies.
 */
function pushOutcomeOf(
  ok: boolean,
  verdicts: ReadonlyMap<string, RefVerdict> | undefined,
  fallback: string | undefined,
  targets: PushTarget[],
): { commit: string } {
  const [first] = targets;
  if (!first) {
    throw new RemotePushError("push requires at least one refspec; none were given");
  }

  if (!ok) {
    const rejected = [...(verdicts ?? [])]
      .filter(([, verdict]) => !verdict.success)
      .map(([name, verdict]) => `${name}: ${verdict.reason ?? "no reason reported"}`);
    if (fallback) rejected.push(fallback);
    const detail = rejected.length ? rejected.join("; ") : "no reason reported";
    throw new RemotePushError(`push failed: ${detail}`);
  }
  if (verdicts) {
    for (const t of targets) {
      const verdict = verdicts.get(t.destination);
      if (!verdict) {
        throw new RemotePushError(
          `push reported success but said nothing about '${t.destination}' ` +
            `(refspec '${pushRefspecOf(t)}'): the transport skipped it and nothing was written.`,
        );
      }
      if (!verdict.success) {
        throw new RemotePushError(
          `push rejected '${t.destination}' (refspec '${pushRefspecOf(t)}'): ${verdict.reason ?? "no reason reported"}`,
        );
      }
    }
  }

  return { commit: first.commit };
}

/**
 * The HTTP `push()` result → the exception-shaped `GitRemote` contract.
 *
 * `push()` throws on transport failures (an HTTP error, a 401) and reports refused
 * refs in `updates`, one per remote ref with git's status. The failure table is
 * {@link pushOutcomeOf}'s, with a rejected `unpack` (the server could not store the
 * pack) as the overall reason when no ref names one.
 *
 * On success the commit returned is the **first refspec's** — the locally
 * resolved id of its source ref. For a multi-refspec push the other refspecs
 * still land; only one commit id fits `GitRemote.push`'s return type, and the
 * first is the one the caller named first.
 */
export function httpPushOutcome(
  result: PushClientResult,
  targets: PushTarget[],
): { commit: string } {
  const verdicts = new Map(result.updates.map((u) => [u.remoteRef, verdictOf(u)] as const));
  const unpack =
    result.unpack && !result.unpack.ok
      ? `unpack failed: ${result.unpack.message ?? "no reason reported"}`
      : undefined;
  return pushOutcomeOf(result.ok, verdicts, unpack, targets);
}

/**
 * `pushOverDuplex`'s result → the `GitRemote` contract.
 *
 * `pushOverDuplex` never throws: a transport failure comes back as
 * `success: false` with `error`, and `refStatus` holds each matched remote ref's
 * verdict (keyed by remote ref) once the push reached the server. The failure table
 * is {@link pushOutcomeOf}'s; a result without `refStatus` is judged on `success`
 * alone. Same first-refspec rule as {@link httpPushOutcome}.
 */
export function duplexPushOutcome(result: PushResult, targets: PushTarget[]): { commit: string } {
  const verdicts =
    result.refStatus &&
    new Map(
      [...result.refStatus].map(
        ([name, status]) =>
          [
            name,
            status.success
              ? { success: true }
              : { success: false, reason: status.error ?? status.status },
          ] as const,
      ),
    );
  return pushOutcomeOf(result.success, verdicts, result.error, targets);
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
 * Built on the transport's `push()` directly rather than on this package's own
 * `pushToHttpRemote` (`src/remotes/http-remote.ts`): that one pushes a single
 * same-named ref and reports `{ok, updates}`, while `GitRemote.push` takes arbitrary
 * refspecs and answers with a commit or throws.
 */
export function createHttpGitRemote(git: Git, options: HttpGitRemoteOptions): GitRemote {
  const refs = createTransportRefStore(historyOf(git).refs);
  const fetchImpl = options.fetchFn && fetchImplOf(options.fetchFn);
  return {
    async push(refspecs: string[]): Promise<{ commit: string }> {
      const targets = await pushTargetsOf(refspecs, refs);
      // Transport failures (an HTTP error, a 401) throw from here; refused refs come
      // back in the result.
      const result = await transportPush({
        url: options.url,
        repository: repositoryFacadeOf(git),
        refStore: refs,
        refspecs: targets.map(httpRefspecOf),
        auth: options.credentials,
        headers: options.headers,
        fetchImpl,
      });
      await assertNoRefDrift(targets, refs);
      return httpPushOutcome(result, targets);
    },
  };
}

/**
 * A `vcs-workspace` `GitRemote` that pushes over any bidirectional byte stream —
 * MessagePort, WebSocket, WebRTC, a webrun channel.
 *
 * Same first-refspec rule as {@link createHttpGitRemote}, and the same local
 * commit resolution; what differs is the result shape — `pushOverDuplex` reports
 * failures instead of throwing them — see {@link duplexPushOutcome}.
 */
export function createDuplexGitRemote(git: Git, options: DuplexGitRemoteOptions): GitRemote {
  const refs = createTransportRefStore(historyOf(git).refs);
  return {
    async push(refspecs: string[]): Promise<{ commit: string }> {
      // Before `connect()`: an unresolvable refspec must not open a session.
      const targets = await pushTargetsOf(refspecs, refs);
      const result = await pushOverDuplex({
        duplex: await options.connect(),
        repository: repositoryFacadeOf(git),
        refStore: refs,
        refspecs: targets.map(duplexRefspecOf),
        atomic: options.atomic,
      });
      await assertNoRefDrift(targets, refs);
      return duplexPushOutcome(result, targets);
    },
  };
}
