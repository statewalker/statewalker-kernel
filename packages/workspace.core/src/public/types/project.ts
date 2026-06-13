import { joinPath } from "@statewalker/webrun-files";
import { Adaptable } from "./adaptable.js";
import type { AdaptersRegistry } from "./adapters-registry.js";
import type { Resource } from "./resource.js";
import type { Workspace } from "./workspace.js";

/** Default name of a project's system folder (holds persisted build state). */
export const DEFAULT_SYSTEM_FOLDER = ".project";

/**
 * A handle on a top-level project directory. Holds its root directory `Resource`
 * for file access; class-keyed adaptable at the project level (its nature /
 * `ProjectBuilder` resolve from the workspace registry and cache here).
 */
export class Project extends Adaptable {
  constructor(
    readonly workspace: Workspace,
    readonly root: Resource,
  ) {
    super();
  }

  /** The project root directory path (under the workspace `FilesApi`). */
  get path(): string {
    return this.root.path;
  }

  /** The top-level directory name that keys this project in the workspace cache. */
  get projectName(): string {
    const segments = this.root.path.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? "";
  }

  protected get adapterLevel() {
    return "project" as const;
  }

  protected get adaptersRegistry(): AdaptersRegistry {
    return this.workspace.adaptersRegistry;
  }

  /** Resolve a project-relative path against the project root. */
  resolveProjectPath(path: string): string {
    return joinPath(this.root.path, path);
  }

  /** Resolve a `Resource` under this project. */
  getProjectResource(path: string, create = false): Promise<Resource | null> {
    return this.workspace.getResource(this.resolveProjectPath(path), create);
  }
}
