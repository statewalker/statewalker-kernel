import type { Project } from "../types/project.js";

/**
 * Project-bound aliases of the generic builder types from `@statewalker/webrun-builder`.
 * Binding `THost = Project` here lets every existing consumer keep its unparameterized
 * `RegisteredBuilder` / `BuilderProvider` / `BuilderHandler` usage while the engine
 * itself stays project-agnostic. The host-agnostic types pass through unchanged.
 */
export type {
  BuildProgress,
  BuildStatus,
  BuilderUpdate,
  EmittedUpdate,
  SignalName,
  YieldConfig,
} from "@statewalker/webrun-builder";

export type RegisteredBuilder = import("@statewalker/webrun-builder").RegisteredBuilder<Project>;
export type BuilderProvider = import("@statewalker/webrun-builder").BuilderProvider<Project>;
export type BuilderHandler = import("@statewalker/webrun-builder").BuilderHandler<Project>;
