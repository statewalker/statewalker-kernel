import type { FilesApi } from "@statewalker/webrun-files";
import { CompositeFilesApi } from "@statewalker/webrun-files-composite";
import type { Project } from "@statewalker/workspace.core";

/**
 * One rooted view per `Project` instance. Memoised so every part of the nature
 * — the object store, the worktree, the staging area — sees the same handle,
 * and so `repoFilesOf(project)` is safe to call on any code path.
 */
const rooted = new WeakMap<Project, FilesApi>();

/**
 * The `FilesApi` a project's repository lives on: the workspace filesystem
 * re-rooted at the project directory, so the repo sees `/` where the workspace
 * sees `<project>/`.
 *
 * This is what keeps `.git` per project and keeps one project's repository
 * invisible to its siblings — the whole nature is built on paths that never
 * mention the project root.
 */
export function repoFilesOf(project: Project): FilesApi {
  let files = rooted.get(project);
  if (!files) {
    files = new CompositeFilesApi(project.workspace.files, project.path);
    rooted.set(project, files);
  }
  return files;
}
