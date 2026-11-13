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
 * Where `ProjectBuilder` keeps the versions of the builders it ran: a key outside the
 * engine's own namespaces (single-letter prefixes followed by U+0001).
 */
const VERSIONS_KEY = "project-builder\u0001versions";

interface Built {
  generation: number;
  ids: ReadonlySet<string>;
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
 * between runs (a run in progress, and the reads made meanwhile, keep the run's engine). A
 * builder the store has not run before (or whose `version` changed) has all its tasks
 * queued, so it covers the files scanned before it was registered.
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
  run(opts?: ProjectBuildOptions): Promise<ProjectBuildResult> {
    const result = this.chain.then(() => this.runOnce(opts));
    this.chain = result.catch(() => undefined);
    return result;
  }

  private async runOnce(opts?: ProjectBuildOptions): Promise<ProjectBuildResult> {
    this.current(); // brings `this.built` up to date
    const built = this.built as Built;
    this.running = built;
    try {
      const engine = await built.engine;
      const ids = built.ids;
      const ignore = this.sourceIgnore ? await this.sourceIgnore() : undefined;
      if (opts?.retryFailed ?? true) {
        for (const d of await engine.deadLetters()) {
          if (ids.has(d.builder)) await engine.requeue(d.builder, d.key);
        }
      }
      const stats: RunStats = {
        executed: 0,
        skipped: 0,
        failed: 0,
        deadLettered: 0,
        pending: false,
      };
      const scanned: ScanResult = { seen: 0, changed: 0, removed: 0, more: false };
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
        // `maxTasks` bounds the whole run, across passes.
        const maxTasks =
          opts?.maxTasks === undefined ? undefined : opts.maxTasks - stats.executed - stats.failed;
        if (maxTasks !== undefined && maxTasks <= 0) {
          stats.pending = true;
          break;
        }
        const run = await engine.run({
          maxTasks,
          signal: opts?.signal,
          onProgress: opts?.onProgress,
        });
        stats.executed += run.executed;
        stats.skipped += run.skipped;
        stats.failed += run.failed;
        stats.deadLettered += run.deadLettered;
        stats.pending = run.pending;
        if (!scan.more || run.pending || opts?.signal?.aborted) break;
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
      this.running = undefined;
    }
  }

  /**
   * Re-run every task of a builder (its code changed); downstream re-runs where outputs
   * change. For a builder registered after the current engine was made (during a run), it
   * applies when the next engine is made, before the next run.
   */
  async restartFrom(builderId: string): Promise<void> {
    const built = this.running ?? this.current();
    const engine = await built.engine;
    if (built.ids.has(builderId)) await engine.invalidate(builderId);
    else if (this.builders.has(builderId)) this.pendingRestarts.add(builderId);
    else throw new Error(`ProjectBuilder: unknown builder "${builderId}"`);
  }

  async status(): Promise<BuildStatus> {
    return (await this.getEngine()).status();
  }

  /** Dead letters of the registered builders. */
  async deadLetters(): Promise<DeadLetter[]> {
    const built = this.running ?? this.current();
    const engine = await built.engine;
    return (await engine.deadLetters()).filter((d) => built.ids.has(d.builder));
  }

  async get(collection: string, key: string): Promise<Json | undefined> {
    return (await this.getEngine()).get(collection, key);
  }

  async list(collection: string): Promise<Row[]> {
    return (await this.getEngine()).list(collection);
  }

  async keys(collection: string): Promise<string[]> {
    return (await this.getEngine()).keys(collection);
  }

  /**
   * The engine over the registered builders. While a run is in progress this is the run's
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
      const store = openStore(
        this.persistence ?? {
          kind: "files",
          files: this.project.workspace.files,
          path: joinPath(this.project.path, DEFAULT_SYSTEM_FOLDER, "state", "build"),
        },
      );
      this.store = store;
      store.catch(() => {
        if (this.store === store) this.store = undefined;
      });
    }
    return this.store;
  }

  private async makeEngine(builders: RegisteredBuilder[]): Promise<BuildEngine> {
    const store = await this.openStore();
    const engine = new BuildEngine({
      store,
      builders: builders.map((b) => this.bind(b)),
      logger: this.log,
      ...this.tuning,
    });
    // Queue every task of a builder this store has not run (or ran at another version).
    const raw = await store.get(VERSIONS_KEY);
    const known = (raw ? JSON.parse(raw) : {}) as Record<string, string>;
    const versions: Record<string, string> = {};
    for (const b of builders) {
      const version = String(b.version ?? "");
      versions[b.id] = version;
      if (known[b.id] !== version || this.pendingRestarts.has(b.id)) {
        await engine.invalidate(b.id);
      }
      this.pendingRestarts.delete(b.id);
    }
    // Unregistered builders are dropped: registered again later, they start over (their
    // inputs may have changed meanwhile without queuing them).
    const json = JSON.stringify(versions);
    if (json !== raw) await store.commit([{ key: VERSIONS_KEY, value: json }]);
    return engine;
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
