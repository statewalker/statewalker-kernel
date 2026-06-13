import type { Project } from "../types/project.js";
import { ProjectBuilder } from "./project-builder.js";
import type { BuilderProvider } from "./types.js";

/**
 * Apply a project "nature" — register every builder a `BuilderProvider` returns
 * on the project's `ProjectBuilder`. Returns a function that unregisters them.
 */
export function applyNature(project: Project, provider: BuilderProvider): () => void {
  const builder = project.requireAdapter(ProjectBuilder);
  const unregister = provider.builders().map((b) => builder.registerBuilder(b));
  return () => {
    for (const u of unregister) u();
  };
}
