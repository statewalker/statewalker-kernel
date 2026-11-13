import {
  BuildEngine,
  type BuildEngineOptions,
  type BuilderDef,
  type BuildStatus,
  type DeadLetter,
  type Json,
  type KV,
  openStore,
  type PersistenceConfig,
  type Row,
  type RunOptions,
  type RunProgress,
  type RunStats,
  type ScanResult,
  SOURCES_COLLECTION,
  scanSources,
} from "@statewalker/webrun-builder";
import { joinPath } from "@statewalker/webrun-files";
import { loggerOf } from "../types/logger.js";
import { DEFAULT_SYSTEM_FOLDER, type Project } from "../types/project.js";
import type { RegisteredBuilder } from "./types.js";

/** Engine knobs a host may tune (see `ProjectBuilder.configureEngine`). */
export type EngineTuning = Partial<
  Pick<BuildEngineOptions, "concurrency" | "batchSize" | "maxAttempts">
>;

/** Result of one `ProjectBuilder.run()`: the source scan plus the engine run. */
export interface ProjectBuildResult extends RunStats {
  scanned: ScanResult;
  /** Tasks of the registered builders that keep failing (dead letters); their previous outputs are kept. */
  failures: DeadLetter[];
}

/**
 * One step of `ProjectBuilder.steps()`: a scan of (a batch of) the project's files into
 * `sources`, or one committed batch of the engine.
 */
export type ProjectBuildStep = ({ kind: "scan" } & ScanResult) | ({ kind: "batch" } & RunProgress);

export interface ProjectBuildOptions extends RunOptions {
  /**
   * Retry the tasks that failed in earlier runs (default true). With `false` a failed task
   * waits until something it reads changes — for expensive steps (an LLM call) that would
   * fail the same way again.
   */
  retryFailed?: boolean;
  /** Reject when tasks failed (default true); with `false` read `result.failures`. */
  failOnError?: boolean;
}

/**
 * Where `ProjectBuilder` keeps its record of the builders it ran: a key outside the
 * engine's own namespaces (single-letter prefixes followed by U+0001).
 */
const BUILDERS_KEY = "project-builder\u0001builders";

/**
 * `epoch` counts the runs that changed something (a source written or removed, a task
 * executed); each builder records its code version and the epoch it was last run at. A
 * builder registered again is caught up only if something changed while it was absent.
 */
interface BuildersRecord {
  epoch: number;
  builders: Record<string, { version: string; epoch: number }>;
}

interface Built {
  generation: number;
  ids: ReadonlySet<string>;
  /** The code version of each builder the engine was made with. */
  versions: ReadonlyMap<string, string>;
  engine: Promise<BuildEngine>;
}

/**
 * The project-level build engine, resolved via `project.requireAdapter(ProjectBuilder)`.
 *
 * A project "nature" contributes builders (`registerBuilder`, or `applyNature` with a
 * `BuilderProvider`); each `run()` mirrors the project's files into the `sources`
 * collection (`scanSources`: one row per file, `.projectignore` and the configured
 * ignore predicate honoured, dot-folders skipped) and runs the
 * `@statewalker/webrun-builder` engine to convergence. A builder's `run(ctx, project)` and
 * `dispose(key, outputs, project)` receive the project as their second argument.
 *
 * State (rows, queue, traces) persists by default in the project's
 * `<systemFolder>/state/build` folder (a `FilesKV` over the workspace files), so a new
 * session continues incrementally; `configurePersistence` picks another store. The store is
 * opened once; when the builder set changes, a new engine over the same store is made
 * between runs (a run in progress, and the reads made meanwhile, keep the run's engine).
 * Before each run, a builder the store has not run before, ran at another `version`, or that
 * was absent while something changed has all its tasks queued, so it covers the files
 * scanned before it was registered.
 *
 * Invariant: the logger is resolved once at construction (`loggerOf`), so the host must
 * register its `LoggerAdapter` BEFORE resolving `ProjectBuilder`.
 */
export class ProjectBuilder {
  private readonly builders = new Map<string, RegisteredBuilder>();
  private persistence?: PersistenceConfig;
  private sourceIgnore?: () => Promise<(uri: string) => boolean>;
  private scanBatch?: number;
  private tuning: EngineTuning = {};
  private store?: Promise<KV>;
  /** Closes the open store's guard (see `reopen`). */
  private closeStore?: () => void;
  /** Accessor calls in flight (not serialised with runs); `reopen` waits for them. */
  private readonly inflight = new Set<Promise<unknown>>();
  /** A `reopen` in progress: runs queue behind it, accessor calls wait for it. */
  private reopening?: Promise<void>;
  /** Bumped whenever the builder set or the tuning changes. */
  private generation = 0;
  private built?: Built;
  /** The engine of the run in progress. */
  private running?: Built;
  /** `restartFrom` calls for builders the current engine does not know yet. */
  private readonly pendingRestarts = new Set<string>();
  private chain: Promise<unknown> = Promise.resolve();
  private readonly log;

  constructor(readonly project: Project) {
    this.log = loggerOf(project, "ProjectBuilder");
  }

  /** Register (or replace, by id) a builder; returns a function that unregisters it. */
  registerBuilder(builder: RegisteredBuilder): () => void {
    this.builders.set(builder.id, builder);
    this.generation++;
    return () => {
      if (this.builders.get(builder.id) !== builder) return;
      this.builders.delete(builder.id);
      this.generation++;
    };
  }

  /** Ids of the registered builders, in registration order. */
  registeredBuilders(): string[] {
    return [...this.builders.keys()];
  }

  /**
   * Scan at most this many new or changed files at a time (a positive integer; default: all
   * at once): each batch runs through the whole pipeline before the next is scanned, so
   * terminal builders (indexes, dumps) produce partial results early on a large project.
   */
  configureScanBatch(limit: number | undefined): this {
    if (limit !== undefined && !(Number.isInteger(limit) && limit >= 1)) {
      throw new RangeError(`configureScanBatch: a positive integer expected, got ${limit}`);
    }
    this.scanBatch = limit;
    return this;
  }

  /**
   * Engine tuning: `concurrency` (tasks of one batch run in parallel — for builders that wait
   * on I/O or an LLM), `batchSize` (tasks per commit) and `maxAttempts` (attempts before a
   * failing task becomes a dead letter). Defaults are the engine's (1, 64, 3).
   */
  configureEngine(tuning: EngineTuning): this {
    this.tuning = { ...this.tuning, ...tuning };
    this.generation++;
    return this;
  }

  /**
   * Where the engine keeps its state (default: files under `.project/state/build`). Call it
   * before the first run or read: the store opened then serves the builder's lifetime.
   */
  configurePersistence(config: PersistenceConfig): this {
    if (this.store) throw new Error("ProjectBuilder: the store is already open");
    this.persistence = config;
    return this;
  }

  /**
   * An extra source-exclusion predicate, OR-ed with `.projectignore`; re-invoked at the
   * start of every scan, so its rules can change between runs. A newly excluded source is
   * removed from `sources`, which retracts everything derived from it.
   */
  configureSourceIgnore(provider: () => Promise<(uri: string) => boolean>): this {
    this.sourceIgnore = provider;
    return this;
  }

  /**
   * Scan the project's files and run the builders to convergence. Runs are serialised.
   * Tasks that failed last time are retried (`retryFailed`); if some still fail (dead
   * letters), the run rejects with the first error after everything else converged
   * (`failOnError: false` resolves with them in `failures` instead). Dead letters of
   * builders that are not registered are ignored.
   */
  async run(opts?: ProjectBuildOptions): Promise<ProjectBuildResult> {
    const steps = this.steps(opts);
    for (;;) {
      const next = await steps.next();
      if (next.done) return next.value;
    }
  }

  /**
   * `run()` one step at a time: an async generator that yields each scan and each committed
   * engine batch, and returns the run's result (or throws as `run()` rejects). The build
   * waits at every `yield` — nothing is in flight then — so the caller may pause between
   * steps, or stop with `break` / `return()`: the next run continues from the queue. Runs are
   * serialised: a suspended generator holds its turn (later `run()`s and `reopen()` wait), so
   * finish or return it; do not drop it half-way.
   */
  async *steps(
    opts?: ProjectBuildOptions,
  ): AsyncGenerator<ProjectBuildStep, ProjectBuildResult, void> {
    let release!: () => void;
    const turn = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.chain;
    this.chain = previous.then(() => turn);
    try {
      await previous;
      return yield* this.stepsOnce(opts);
    } finally {
      release();
    }
  }

  private async *stepsOnce(
    opts?: ProjectBuildOptions,
  ): AsyncGenerator<ProjectBuildStep, ProjectBuildResult, void> {
    this.current(); // brings `this.built` up to date
    const built = this.built as Built;
    this.running = built;
    let engine: BuildEngine | undefined;
    let record: BuildersRecord | undefined;
    const stats: RunStats = { executed: 0, skipped: 0, failed: 0, deadLettered: 0, pending: false };
    const scanned: ScanResult = { seen: 0, changed: 0, removed: 0, more: false };
    try {
      engine = await built.engine;
      const ids = built.ids;
      record = await this.catchUp(engine, built);
      const ignore = this.sourceIgnore ? await this.sourceIgnore() : undefined;
      if (opts?.retryFailed ?? true) {
        for (const d of await engine.deadLetters()) {
          if (ids.has(d.builder)) await engine.requeue(d.builder, d.key);
        }
      }
      let cursor: string | undefined;
      // Without a batch size: one scan, one run. With one: scan a batch, run it through the
      // whole pipeline, repeat — so downstream results appear batch by batch. Files that keep
      // changing during the run would keep `more` true: the passes are bounded by one
      // rotation over the files seen (the next run picks up the rest).
      for (let pass = 1; ; pass++) {
        const scan = await scanSources(engine, {
          files: this.project.workspace.files,
          root: this.project.path,
          collection: SOURCES_COLLECTION,
          ignore,
          limit: this.scanBatch,
          after: cursor,
        });
        scanned.seen = scan.seen;
        scanned.changed += scan.changed;
        scanned.removed += scan.removed;
        scanned.more = scan.more;
        cursor = scan.cursor ?? cursor;
        yield { kind: "scan", ...scan };
        // `maxTasks` bounds the whole run, across passes.
        const maxTasks =
          opts?.maxTasks === undefined
            ? undefined
            : opts.maxTasks - stats.executed - stats.skipped - stats.failed;
        if (maxTasks !== undefined && maxTasks <= 0) {
          stats.pending = true;
          break;
        }
        const batches = engine.steps({
          maxTasks,
          signal: opts?.signal,
          onProgress: opts?.onProgress,
        });
        try {
          for (;;) {
            const next = await batches.next();
            if (next.done) {
              stats.pending = next.value.pending;
              break;
            }
            const p = next.value;
            stats.executed += p.executed;
            stats.skipped += p.skipped;
            stats.failed += p.failed;
            stats.deadLettered += p.deadLettered;
            yield { kind: "batch", ...p };
          }
        } finally {
          // After `break` / `return()` / a throw at the yield: release the engine (a no-op
          // when its generator already finished).
          await batches.return(stats);
        }
        if (!scan.more || stats.pending || opts?.signal?.aborted) break;
        if (pass > Math.ceil(scan.seen / (this.scanBatch ?? 1))) break;
      }
      const failed = (await engine.deadLetters()).filter((d) => ids.has(d.builder));
      if (failed.length > 0 && (opts?.failOnError ?? true)) {
        const [first] = failed;
        this.log.error("build failed", { failed: failed.length, first });
        throw new Error(
          `ProjectBuilder: ${failed.length} task(s) failed; first: ${first?.builder}/${first?.key}: ${first?.error}`,
        );
      }
      return { ...stats, scanned, failures: failed };
    } finally {
      // Also after `break`, `return()` or a throw: what this run changed is recorded, so a
      // builder absent from it catches up later.
      if (engine && record) {
        const changed = scanned.changed + scanned.removed + stats.executed > 0;
        try {
          await this.recordRun(built, record, changed);
        } catch (error) {
          this.log.error("could not record the run", { error: String(error) });
        }
      }
      this.running = undefined;
    }
  }

  /**
   * Drop the open store and engine, so the next access reads the store again — after another
   * process (a browser tab, a CLI) wrote it: a `FilesKV` store keeps its rows in memory and
   * allows one writer at a time, so a host that alternates writers (a lease) calls this when
   * it takes the lease. Waits for the run in progress and the reads in flight; runs and reads
   * started meanwhile wait for the reopen.
   */
  reopen(): Promise<void> {
    const reopening = this.chain.then(async () => {
      while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
      this.closeStore?.();
      this.closeStore = undefined;
      this.store = undefined;
      this.built = undefined;
    });
    this.reopening = reopening;
    this.chain = reopening.catch(() => undefined);
    const done = () => {
      if (this.reopening === reopening) this.reopening = undefined;
    };
    reopening.then(done, done);
    return reopening;
  }

  /** Track an accessor call, so `reopen` waits for it (or wait for a pending `reopen`). */
  private track<T>(call: () => Promise<T>): Promise<T> {
    // A pending reopen queues behind the run in progress; while a run holds the turn the
    // call is served by the run's engine (and tracked, so the reopen waits for it) instead
    // of waiting: a `steps()` consumer awaiting a read between steps would otherwise
    // deadlock with the reopen queued behind its own suspended run.
    const reopening = this.reopening;
    if (reopening && !this.running) return reopening.then(() => this.track(call));
    const p = call();
    this.inflight.add(p);
    const done = () => this.inflight.delete(p);
    p.then(done, done);
    return p;
  }

  /**
   * Re-run every task of a builder (its code changed); downstream re-runs where outputs
   * change. For a builder registered after the current engine was made (during a run), it
   * applies when the next engine is made, before the next run.
   */
  restartFrom(builderId: string): Promise<void> {
    return this.track(() => this.restart(builderId));
  }

  private async restart(builderId: string): Promise<void> {
    const built = this.running ?? this.current();
    const engine = await built.engine;
    if (built.ids.has(builderId)) await engine.invalidate(builderId);
    else if (this.builders.has(builderId)) this.pendingRestarts.add(builderId);
    else throw new Error(`ProjectBuilder: unknown builder "${builderId}"`);
  }

  /** Queued tasks per builder, and the dead letters of the registered builders. */
  status(): Promise<BuildStatus> {
    return this.track(async () => {
      const built = this.running ?? this.current();
      const engine = await built.engine;
      const status = await engine.status();
      const deadLetters = (await engine.deadLetters()).filter((d) => built.ids.has(d.builder));
      return { ...status, deadLetters: deadLetters.length };
    });
  }

  /** Dead letters of the registered builders. */
  deadLetters(): Promise<DeadLetter[]> {
    return this.track(async () => {
      const built = this.running ?? this.current();
      const engine = await built.engine;
      return (await engine.deadLetters()).filter((d) => built.ids.has(d.builder));
    });
  }

  get(collection: string, key: string): Promise<Json | undefined> {
    return this.track(async () => (await this.getEngine()).get(collection, key));
  }

  list(collection: string): Promise<Row[]> {
    return this.track(async () => (await this.getEngine()).list(collection));
  }

  keys(collection: string): Promise<string[]> {
    return this.track(async () => (await this.getEngine()).keys(collection));
  }

  /**
   * The engine over the registered builders. Invalid after `reopen()`: a call through an
   * engine obtained before it throws. While a run is in progress this is the run's
   * engine; otherwise it is remade (over the same store) when the builders changed.
   */
  getEngine(): Promise<BuildEngine> {
    return (this.running ?? this.current()).engine;
  }

  /** The engine for the current builder set (made if the set changed). */
  private current(): Built {
    if (this.built && this.built.generation === this.generation) return this.built;
    const builders = [...this.builders.values()];
    const engine = this.makeEngine(builders);
    const built: Built = {
      generation: this.generation,
      ids: new Set(builders.map((b) => b.id)),
      versions: new Map(builders.map((b) => [b.id, String(b.version ?? "")])),
      engine,
    };
    this.built = built;
    engine.catch(() => {
      if (this.built === built) this.built = undefined; // retry on the next call
    });
    return built;
  }

  private openStore(): Promise<KV> {
    if (!this.store) {
      let open = true;
      this.closeStore = () => {
        open = false;
      };
      const store = openStore(
        this.persistence ?? {
          kind: "files",
          files: this.project.workspace.files,
          path: joinPath(this.project.path, DEFAULT_SYSTEM_FOLDER, "state", "build"),
        },
      ).then((kv) => guarded(kv, () => open));
      this.store = store;
      store.catch(() => {
        if (this.store === store) this.store = undefined;
      });
    }
    return this.store;
  }

  private async makeEngine(builders: RegisteredBuilder[]): Promise<BuildEngine> {
    return new BuildEngine({
      store: await this.openStore(),
      builders: builders.map((b) => this.bind(b)),
      logger: this.log,
      ...this.tuning,
    });
  }

  /**
   * Before a run: queue every task of a builder the store has not run, ran at another
   * version, or last ran before something changed (it was not registered meanwhile, so its
   * tasks were not queued), and apply the restarts asked for during the previous run.
   */
  private async catchUp(engine: BuildEngine, built: Built): Promise<BuildersRecord> {
    const store = await this.openStore();
    const raw = await store.get(BUILDERS_KEY);
    const record: BuildersRecord = raw ? JSON.parse(raw) : { epoch: 0, builders: {} };
    // An absent builder's queued tasks (left by an interrupted run, or a restart) are dropped
    // by the engine, which does not know it: it must catch up when registered again.
    const { queued } = await engine.status();
    let marked = false;
    for (const [id, entry] of Object.entries(record.builders)) {
      if (!built.ids.has(id) && (queued[id] ?? 0) > 0 && entry.epoch !== -1) {
        entry.epoch = -1;
        marked = true;
      }
    }
    // Saved now: the run drops those tasks, and it may fail before `recordRun`.
    if (marked) await store.commit([{ key: BUILDERS_KEY, value: JSON.stringify(record) }]);
    for (const id of built.ids) {
      const version = built.versions.get(id) ?? "";
      const known = record.builders[id];
      const behind = !known || known.version !== version || known.epoch !== record.epoch;
      if (behind || this.pendingRestarts.has(id)) await engine.invalidate(id);
      this.pendingRestarts.delete(id);
    }
    return record;
  }

  /**
   * After a run: the registered builders are up to date with the (possibly new) epoch. Tasks
   * an interrupted run left queued stay in the store's queue: the next run with the builder
   * picks them up, and a run without it marks it behind (`catchUp`).
   */
  private async recordRun(built: Built, record: BuildersRecord, changed: boolean): Promise<void> {
    const store = await this.openStore();
    const epoch = changed ? record.epoch + 1 : record.epoch;
    const builders = { ...record.builders };
    for (const id of built.ids) {
      builders[id] = { version: built.versions.get(id) ?? "", epoch };
    }
    await store.commit([{ key: BUILDERS_KEY, value: JSON.stringify({ epoch, builders }) }]);
  }

  /** A project builder as an engine builder: the project is passed through. */
  private bind(b: RegisteredBuilder): BuilderDef {
    const project = this.project;
    const { version: _version, ...def } = b;
    return {
      ...def,
      run: (ctx) => b.run(ctx, project),
      dispose: b.dispose ? (key, outputs) => b.dispose?.(key, outputs, project) : undefined,
    };
  }
}

/**
 * A store that refuses every call once closed: an engine kept from before `reopen()` must
 * not write a store another instance now owns (a `FilesKV` allows one writer per folder).
 */
function guarded(kv: KV, isOpen: () => boolean): KV {
  const check = () => {
    if (!isOpen()) throw new Error("ProjectBuilder: the store was reopened; get a new engine");
  };
  return {
    get: (key) => {
      check();
      return kv.get(key);
    },
    scan: (prefix, opts) => {
      check();
      return kv.scan(prefix, opts);
    },
    commit: (writes) => {
      check();
      return kv.commit(writes);
    },
  };
}
