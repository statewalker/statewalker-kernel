import type { AdapterCtor, AdapterFactory, AdapterLevel } from "../types/adapters-registry.js";
import type { Project } from "../types/project.js";
import type { Workspace } from "../types/workspace.js";
import { ProjectBuilder } from "./project-builder.js";
import type { BuilderProvider, RegisteredBuilder } from "./types.js";

/**
 * One class-keyed adapter a nature contributes, at a given level (usually
 * `"project"`). The factory is the same `(host) => instance | null` the registry
 * stores; `host` is the level's handle (`Workspace` / `Project` / `Resource`).
 */
export interface NatureAdapter<T = unknown> {
  level: AdapterLevel;
  type: AdapterCtor<T>;
  // biome-ignore lint/suspicious/noExplicitAny: factory host is the level's handle type
  factory: AdapterFactory<T, any>;
}

/**
 * A project *nature* — a project kind declared as a bundle of contributions: the
 * class-keyed adapters it needs plus the builders it adds to a project's pipeline.
 * Applied uniformly via `applyNature(workspace, nature)`.
 */
export interface Nature {
  adapters(): readonly NatureAdapter[];
  builders(): readonly RegisteredBuilder[];
}

/**
 * A `BuilderProvider` holding a nature's builders, registered as a project-level
 * adapter by `applyNature(workspace, nature)` so each project can resolve its
 * nature's builders (`project.requireAdapter(NatureBuilders)`) and attach them via
 * the per-project `applyNature(project, provider)` step.
 */
export class NatureBuilders implements BuilderProvider {
  constructor(private readonly _builders: readonly RegisteredBuilder[]) {}
  builders(): readonly RegisteredBuilder[] {
    return this._builders;
  }
}

/**
 * Apply a project "nature" — register every builder a `BuilderProvider` returns
 * on the project's `ProjectBuilder`. Returns a function that unregisters them.
 */
export function applyNature(project: Project, provider: BuilderProvider): () => void;
/**
 * Apply a nature to a workspace: register its class-keyed adapters on the shared
 * registry (each resolved per handle at its level) AND expose its builders as a
 * project-level `NatureBuilders` provider — the per-project builder step any
 * project of that nature applies via `applyNature(project, provider)`. Returns a
 * disposer that unregisters every adapter and the builder provider.
 */
export function applyNature(workspace: Workspace, nature: Nature): () => void;
export function applyNature(host: Project | Workspace, spec: BuilderProvider | Nature): () => void {
  if ("adapters" in spec) return applyWorkspaceNature(host as Workspace, spec);
  return applyProjectBuilders(host as Project, spec);
}

/** Register a `BuilderProvider`'s builders on a project's `ProjectBuilder`. */
function applyProjectBuilders(project: Project, provider: BuilderProvider): () => void {
  const builder = project.requireAdapter(ProjectBuilder);
  const unregister = provider.builders().map((b) => builder.registerBuilder(b));
  return () => {
    for (const u of unregister) u();
  };
}

/** Register a nature's adapters + builder provider on a workspace registry. */
function applyWorkspaceNature(workspace: Workspace, nature: Nature): () => void {
  const registry = workspace.adaptersRegistry;
  const disposers = nature.adapters().map((a) => registry.register(a.level, a.type, a.factory));
  const builders = [...nature.builders()];
  disposers.push(registry.register("project", NatureBuilders, () => new NatureBuilders(builders)));
  return () => {
    for (const d of disposers) d();
  };
}
