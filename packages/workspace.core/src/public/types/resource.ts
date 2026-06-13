import type { FileStats } from "@statewalker/webrun-files";
import { normalizePath } from "@statewalker/webrun-files";
import { getMimeType } from "../../internal/get-mime-type.js";
import { Adaptable } from "./adaptable.js";
import type { AdaptersRegistry } from "./adapters-registry.js";
import type { Workspace } from "./workspace.js";

/**
 * A handle on a file/dir under the workspace `FilesApi`. Class-keyed adaptable;
 * resolves resource-level adapter factories from the workspace registry.
 */
export class Resource extends Adaptable {
  readonly path: string;
  readonly mimeType: string;

  constructor(
    readonly workspace: Workspace,
    path: string,
  ) {
    super();
    this.path = normalizePath(path);
    this.mimeType = getMimeType(this.path);
  }

  get url(): string {
    return this.path;
  }

  protected get adapterLevel() {
    return "resource" as const;
  }

  protected get adaptersRegistry(): AdaptersRegistry {
    return this.workspace.adaptersRegistry;
  }

  async stats(): Promise<FileStats | undefined> {
    return this.workspace.files.stats(this.path);
  }

  async exists(): Promise<boolean> {
    return !!(await this.stats());
  }
}
