import { loggerOf } from "../types/logger.js";
import type { Project } from "../types/project.js";

/** A batch of file changes surfaced by a single poll. */
export interface WatchEvent {
  /** Project-relative URIs new since the last snapshot, or whose mtime advanced. */
  changed: string[];
  /** Project-relative URIs present in the last snapshot but absent now. */
  removed: string[];
}

/** Receives the subset of a poll's changes matching a subscription's glob scope. */
export type WatchHandler = (event: WatchEvent) => void;

/**
 * Injectable periodic scheduler: given an interval and a `tick`, start calling
 * `tick` every `intervalMs` and return a cancel function. The default binds
 * `setInterval`; tests inject a manual clock so a poll fires deterministically.
 */
export type PollScheduler = (intervalMs: number, tick: () => void | Promise<void>) => () => void;

/** Named built-in fallback poll interval (ms), used when no default is configured. */
export const DEFAULT_WATCH_INTERVAL_MS = 30_000;

const defaultScheduler: PollScheduler = (intervalMs, tick) => {
  const id = setInterval(() => {
    void tick();
  }, intervalMs);
  // Don't keep a Node event loop alive just because a watcher was never stopped
  // (guarded — browser timer ids have no `unref`).
  (id as { unref?: () => void }).unref?.();
  return () => clearInterval(id);
};

interface Subscription {
  match: (uri: string) => boolean;
  handler: WatchHandler;
}

/**
 * Generic project-level watcher, self-hosted as a `project` adapter (resolve via
 * `project.requireAdapter(ProjectWatcher)`). It polls the project's files on a
 * configurable interval, diffs their mtimes against its last snapshot, and emits
 * `{ changed, removed }` to subscribers whose glob scope matches. Knows nothing of
 * any nature; a nature subscribes source-folder globs purely to decide *when* to
 * rebuild. The interval scheduler is injected so it is deterministically testable.
 */
export class ProjectWatcher {
  private snapshot = new Map<string, number>();
  private readonly subscriptions = new Set<Subscription>();
  private scheduler: PollScheduler = defaultScheduler;
  private defaultIntervalMs = DEFAULT_WATCH_INTERVAL_MS;
  private cancel?: () => void;
  /** True once the first poll has seeded the baseline snapshot (see `poll`). */
  private primed = false;
  /** Re-entrancy latch: a slow poll must never overlap the next scheduled tick. */
  private polling = false;

  constructor(readonly project: Project) {}

  /** Override the interval scheduler and/or the bare-`start()` fallback interval. */
  configure(opts: { scheduler?: PollScheduler; defaultIntervalMs?: number }): this {
    if (opts.scheduler) this.scheduler = opts.scheduler;
    if (opts.defaultIntervalMs !== undefined) this.defaultIntervalMs = opts.defaultIntervalMs;
    return this;
  }

  /**
   * (Re)start polling. `intervalMs` sets the poll spacing; when omitted the
   * configured `defaultIntervalMs` (or the built-in default) is used. Restarting
   * re-configures the spacing while existing subscriptions keep receiving events.
   */
  start(intervalMs?: number): this {
    this.stop();
    const interval = intervalMs ?? this.defaultIntervalMs;
    this.cancel = this.scheduler(interval, () => this.poll());
    return this;
  }

  /** Halt polling; no further events are emitted until `start()` is called again. */
  stop(): void {
    this.cancel?.();
    this.cancel = undefined;
  }

  /** Subscribe to changes under a glob `scope`; returns an unsubscribe function. */
  watch(scope: string, handler: WatchHandler): () => void {
    const match = globMatcher(scope);
    const sub: Subscription = { match, handler };
    this.subscriptions.add(sub);
    return () => {
      this.subscriptions.delete(sub);
    };
  }

  /**
   * Walk the project files, diff their mtimes against the last snapshot, and deliver
   * the matching slice of `{ changed, removed }` to each subscriber. A poll that finds
   * no difference delivers nothing. Dot-prefixed segments (the `.project/` system
   * folder, `.git`, …) are skipped so system writes never trigger the watcher.
   */
  async poll(): Promise<void> {
    // A poll suspends on `files.list`; the latch stops the next scheduled tick from
    // starting a second, overlapping poll (which would double-deliver the same diff).
    if (this.polling) return;
    this.polling = true;
    try {
      const files = this.project.workspace.files;
      const base = this.project.path.replace(/^\/+|\/+$/g, "");
      const seen = new Map<string, number>();
      for await (const info of files.list(this.project.path, { recursive: true })) {
        if (info.kind !== "file") continue;
        const uri = toProjectUri(info.path, base);
        if (uri === undefined) continue;
        if (uri.split("/").some((seg) => seg.startsWith("."))) continue;
        seen.set(uri, info.lastModified ?? 0);
      }
      // The first poll seeds the baseline silently: a project's initial contents are
      // not a change, so a `watch()`→`start()` consumer must not receive a spurious
      // all-files batch. Only differences observed after this seed are delivered.
      if (!this.primed) {
        this.snapshot = seen;
        this.primed = true;
        return;
      }
      const changed: string[] = [];
      for (const [uri, mtime] of seen) {
        const prev = this.snapshot.get(uri);
        // Known limitation: two writes within one clock ms reuse `lastModified`, so
        // the second is invisible here — inherent to mtime polling and shared with
        // ProjectBuilder's scanner (the authoritative "what"), not fixable locally.
        if (prev === undefined || prev !== mtime) changed.push(uri);
      }
      const removed: string[] = [];
      for (const uri of this.snapshot.keys()) {
        if (!seen.has(uri)) removed.push(uri);
      }
      this.snapshot = seen;
      if (changed.length === 0 && removed.length === 0) return;
      changed.sort();
      removed.sort();
      // Iterate a snapshot of the subscriber set (a handler may subscribe/unsubscribe
      // mid-delivery) and isolate each handler: the snapshot above is already
      // committed, so a throwing subscriber neither aborts its siblings nor drops the
      // batch.
      for (const sub of [...this.subscriptions]) {
        const c = changed.filter(sub.match);
        const r = removed.filter(sub.match);
        if (c.length === 0 && r.length === 0) continue;
        try {
          sub.handler({ changed: c, removed: r });
        } catch (error) {
          loggerOf(this.project, "ProjectWatcher").error("watch handler threw", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      this.polling = false;
    }
  }
}

/** Map a filesystem path under the project root to a project-relative bare URI. */
function toProjectUri(fsPath: string, base: string): string | undefined {
  const p = fsPath.replace(/^\/+/, "");
  if (base === "") return p;
  if (p === base) return undefined;
  if (!p.startsWith(`${base}/`)) return undefined;
  return p.slice(base.length + 1);
}

/**
 * Compile a minimatch-style glob to a URI predicate: `**` spans path separators,
 * `*` matches within a single segment, and every other character is literal (so
 * `client/**` matches `client/main.tsx` and `package.json` matches only itself).
 */
function globMatcher(glob: string): (uri: string) => boolean {
  // URIs are project-relative and bare (no leading slash); normalise the scope so a
  // caller-supplied leading slash (`/client/**`) still matches.
  const scope = glob.replace(/^\/+/, "");
  let re = "";
  let hasGlob = false;
  for (let i = 0; i < scope.length; i++) {
    const c = scope.charAt(i);
    if (c === "*") {
      hasGlob = true;
      if (scope.charAt(i + 1) === "*") {
        re += ".*";
        i++;
      } else {
        re += "[^/]*";
      }
    } else if ("\\^$.|?+()[]{}/".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  // A purely-literal scope also matches its subtree, so a bare directory (`client`)
  // matches `client/main.tsx`; glob scopes keep segment semantics (`*` never spans `/`).
  const suffix = hasGlob ? "" : "(?:/.*)?";
  const rx = new RegExp(`^${re}${suffix}$`);
  return (uri) => rx.test(uri);
}
