import type { FilesApi } from "@statewalker/webrun-files";
import { CompositeFilesApi } from "@statewalker/webrun-files-composite";
import { SystemFiles } from "../public/types/system-files.js";
import type { Workspace } from "../public/types/workspace.js";

/**
 * Default `SystemFiles` impl. Produces a `FilesApi` rooted at `systemDir`
 * of the workspace's primary file system, via `buildWorkspaceViews`'s
 * composite subtree view.
 */
export class FilesBackedSystemFiles extends SystemFiles {
  readonly files: FilesApi;

  constructor(workspace: Workspace, systemDir: string) {
    super();
    this.files = new CompositeFilesApi(workspace.files, systemDir);
  }
}
