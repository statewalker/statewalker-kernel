import type { FilesApi } from "@statewalker/webrun-files";
import {
  CompositeFilesApi,
  FilteredFilesApi,
  newRegexpPathFilter,
} from "@statewalker/webrun-files-composite";
import type { Project } from "@statewalker/workspace.core";

/**
 * One rooted view per `Project` instance. Memoised so every part of the nature
 * — the object store, the worktree, the staging area — sees the same handle,
 * and so `repoFilesOf(project)` is safe to call on any code path.
 */
const rooted = new WeakMap<Project, FilesApi>();

/**
 * A path holding a `..` segment.
 *
 * Containment is otherwise delegated to `CompositeFilesApi.resolve` →
 * `normalizePath`, which drops empty and `.` segments and passes `..` through
 * **verbatim**, and `NodeFilesApi.resolvePath` is pure concatenation. On the
 * in-memory backend that is harmless (`..` becomes a literal segment name), and
 * the nature's own paths are constants, so nothing here reaches it today — but the
 * docstring below claims containment, and a claim a backend does not enforce is
 * worth making true rather than worth trusting.
 */
const ESCAPING_SEGMENT = /(^|\/)\.\.(\/|$)/;

/**
 * The `FilesApi` a project's repository lives on: the workspace filesystem
 * re-rooted at the project directory, so the repo sees `/` where the workspace
 * sees `<project>/`.
 *
 * This is what keeps `.git` per project and keeps one project's repository
 * invisible to its siblings — the whole nature is built on paths that never
 * mention the project root, and a path that tries to climb out with `..` is
 * hidden rather than resolved (see {@link ESCAPING_SEGMENT}).
 */
export function repoFilesOf(project: Project): FilesApi {
  let files = rooted.get(project);
  if (!files) {
    files = new FilteredFilesApi(
      new CompositeFilesApi(project.workspace.files, project.path),
      newRegexpPathFilter(ESCAPING_SEGMENT),
    );
    rooted.set(project, files);
  }
  return files;
}
