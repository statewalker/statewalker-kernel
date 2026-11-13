import type { BuilderDef, RowRef, TaskContext } from "@statewalker/webrun-builder";
import type { Project } from "../types/project.js";

/**
 * A builder contributed to a project's pipeline: an `@statewalker/webrun-builder`
 * `BuilderDef` whose `run` / `dispose` also receive the project (resources, adapters,
 * logger), so a nature's builders need not close over a project.
 */
export interface RegisteredBuilder extends Omit<BuilderDef, "run" | "dispose"> {
  /**
   * The builder's code version (default `""`). `ProjectBuilder` remembers, in its store, the
   * version of every builder it ran: a builder it has not seen before — or whose version
   * changed — gets all its tasks re-run (`restartFrom`), so it covers files scanned earlier.
   */
  version?: string | number;
  run(ctx: TaskContext, project: Project): void | Promise<void>;
  dispose?(key: string, outputs: readonly RowRef[], project: Project): void | Promise<void>;
}

/** Something that contributes builders to a project (a nature, or part of one). */
export interface BuilderProvider {
  builders(): readonly RegisteredBuilder[];
}
