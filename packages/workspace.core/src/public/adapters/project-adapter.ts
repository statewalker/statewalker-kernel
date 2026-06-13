import type { FilesApi } from "@statewalker/webrun-files";
import type { AdapterCtor } from "../types/adapters-registry.js";
import type { Project } from "../types/project.js";
import type { Workspace } from "../types/workspace.js";

/**
 * Base for adapters hosted on a `Project`. Self-hostable (`new X(project)`); a
 * factory may also pass registration-time `options`. Delegates adapter lookups to
 * the host project so sibling project adapters share one per-project cache.
 */
export class ProjectAdapter {
  readonly options: Record<string, unknown>;

  constructor(
    readonly project: Project,
    options: Record<string, unknown> = {},
  ) {
    this.options = options;
  }

  get workspace(): Workspace {
    return this.project.workspace;
  }

  get filesApi(): FilesApi {
    return this.project.workspace.files;
  }

  /** The project root path. */
  get path(): string {
    return this.project.path;
  }

  getAdapter<T>(type: AdapterCtor<T>): T | null {
    return this.project.getAdapter(type);
  }

  requireAdapter<T>(type: AdapterCtor<T>): T {
    return this.project.requireAdapter(type);
  }
}
