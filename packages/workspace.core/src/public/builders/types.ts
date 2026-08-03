import type { Project } from "../types/project.js";

/**
 * Project-bound aliases of the generic builder types from `@statewalker/webrun-builder`.
 * Binding `THost = Project` here lets every existing consumer keep its unparameterized
 * `RegisteredBuilder` / `BuilderProvider` / `BuilderHandler` usage while the engine
 * itself stays project-agnostic. The host-agnostic types pass through unchanged
 * via the package root's `export *`, so this shim only re-binds the Project ones.
 */
export type RegisteredBuilder = import("@statewalker/webrun-builder").RegisteredBuilder<Project>;
export type BuilderProvider = import("@statewalker/webrun-builder").BuilderProvider<Project>;
export type BuilderHandler = import("@statewalker/webrun-builder").BuilderHandler<Project>;
