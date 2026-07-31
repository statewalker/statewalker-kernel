import type { Git } from "@statewalker/vcs-commands";
import type { Repository } from "@statewalker/vcs-workspace";
import type { FilesApi } from "@statewalker/webrun-files";
import type { HashContent } from "../util/hash-content.js";

/** The `.git`-excluding view of a project's files — what `manifest()` measures. */
export function trackedFilesOf(_files: FilesApi): FilesApi {
  throw new Error("not implemented");
}

/** The `vcs-workspace` `Repository` over a file-backed `Git`. */
export function createGitRepository(
  _git: Git,
  _files: FilesApi,
  _hashContent: HashContent,
): Repository {
  throw new Error("not implemented");
}
