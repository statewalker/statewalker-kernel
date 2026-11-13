import {
  type BuildEngine,
  type BuilderDef,
  type BuildEngineOptions,
  type BuildStatus,
  createBuildEngine,
  type DeadLetter,
  type Json,
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
  /** Tasks that keep failing (dead letters); their previous outputs are kept. */
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
 * session continues incrementally; `configurePersistence` picks another store.
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
  private engine?: Promise<BuildEngine>;
  private chain: Promise<unknown> = Promise.resolve();
  private readonly log;

  constructor(readonly project: Project) {
    this.log = loggerOf(project, "ProjectBuilder");
  }

  /** Register (or replace, by id) a builder; returns a function that unregisters it. */
  registerBuilder(builder: RegisteredBuilder): () => void {
    this.builders.set(builder.id, builder);
    this.engine = undefined; // the graph changed
    return () => {
      if (this.builders.get(builder.id) !== builder) return;
      this.builders.delete(builder.id);
      this.engine = undefined;
    };
  }

  /** Ids of the registered builders, in registration order. */
  registeredBuilders(): string[] {
    return [...this.builders.keys()];
  }

  /**
   * Scan at most this many new or changed files at a time (default: all at once): each batch
   * runs through the whole pipeline before the next is scanned, so terminal builders (indexes,
   * dumps) produce partial results early on a large project.
   */
  configureScanBatch(limit: number | undefined): this {
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
    this.engine = undefined;
    return this;
  }

  /** Where the engine keeps its state (default: files under `.project/state/build`). */
  configurePersistence(config: PersistenceConfig): this {
    this.persistence = config;
    this.engine = undefined;
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
   * (`failOnError: false` resolves with them in `failures` instead).
   */
  run(opts?: ProjectBuildOptions): Promise<ProjectBuildResult> {
    const result = this.chain.then(() => this.runOnce(opts));
    this.chain = result.catch(() => undefined);
    return result;
  }

  private async runOnce(opts?: ProjectBuildOptions): Promise<ProjectBuildResult> {
    const engine = await this.getEngine();
    const ignore = this.sourceIgnore ? await this.sourceIgnore() : undefined;
    if (opts?.retryFailed ?? true) {
      for (const d of await engine.deadLetters()) await engine.requeue(d.builder, d.key);
    }
    const runOpts = {
      maxTasks: opts?.maxTasks,
      signal: opts?.signal,
      onProgress: opts?.onProgress,
    };
    const stats: RunStats = { executed: 0, skipped: 0, failed: 0, deadLettered: 0, pending: false };
    const scanned: ScanResult = { seen: 0, changed: 0, removed: 0, more: false };
    let cursor: string | undefined;
    // Without a batch size: one scan, one run. With one: scan a batch, run it through the
    // whole pipeline, repeat — so downstream results appear batch by batch.
    for (;;) {
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
      const run = await engine.run(runOpts);
      stats.executed += run.executed;
      stats.skipped += run.skipped;
      stats.failed += run.failed;
      stats.deadLettered += run.deadLettered;
      stats.pending = run.pending;
      if (!scan.more || run.pending || opts?.signal?.aborted) break;
    }
    const failed = await engine.deadLetters();
    if (failed.length > 0 && (opts?.failOnError ?? true)) {
      const [first] = failed;
      this.log.error("build failed", { failed: failed.length, first });
      throw new Error(
        `ProjectBuilder: ${failed.length} task(s) failed; first: ${first?.builder}/${first?.key}: ${first?.error}`,
      );
    }
    return { ...stats, scanned, failures: failed };
  }

  /** Re-run every task of a builder (its code changed); downstream re-runs where outputs change. */
  async restartFrom(builderId: string): Promise<void> {
    await (await this.getEngine()).invalidate(builderId);
  }

  async status(): Promise<BuildStatus> {
    return (await this.getEngine()).status();
  }

  async deadLetters(): Promise<DeadLetter[]> {
    return (await this.getEngine()).deadLetters();
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

  /** The engine over the currently registered builders (rebuilt when they change). */
  getEngine(): Promise<BuildEngine> {
    this.engine ??= createBuildEngine({
      builders: [...this.builders.values()].map((b) => this.bind(b)),
      persistence: this.persistence ?? {
        kind: "files",
        files: this.project.workspace.files,
        path: joinPath(this.project.path, DEFAULT_SYSTEM_FOLDER, "state", "build"),
      },
      logger: this.log,
      ...this.tuning,
    });
    return this.engine;
  }

  /** A project builder as an engine builder: the project is passed through. */
  private bind(b: RegisteredBuilder): BuilderDef {
    const project = this.project;
    return {
      ...b,
      run: (ctx) => b.run(ctx, project),
      dispose: b.dispose ? (key, outputs) => b.dispose?.(key, outputs, project) : undefined,
    };
  }
}
