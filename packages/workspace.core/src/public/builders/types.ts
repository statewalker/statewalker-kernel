import type { BuilderDef, RowRef, TaskContext } from "@statewalker/webrun-builder";
import type { Project } from "../types/project.js";

/**
 * A builder contributed to a project's pipeline: an `@statewalker/webrun-builder`
 * `BuilderDef` whose `run` / `dispose` also receive the project (resources, adapters,
 * logger), so a nature's builders need not close over a project.
 */
export interface RegisteredBuilder extends Omit<BuilderDef, "run" | "dispose"> {
  run(ctx: TaskContext, project: Project): void | Promise<void>;
  dispose?(key: string, outputs: readonly RowRef[], project: Project): void | Promise<void>;
}

/** Something that contributes builders to a project (a nature, or part of one). */
export interface BuilderProvider {
  builders(): readonly RegisteredBuilder[];
}
