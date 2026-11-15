import type { FilesApi } from "@statewalker/webrun-files";
import { CompositeFilesApi, FilteredFilesApi } from "@statewalker/webrun-files-composite";
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
 * `normalizePath` (webrun-files) resolves `..` against the segment before it and
 * **throws** when one would climb above the root, so a filter given the normalised
 * path never sees a `..` at all: `../secret.txt` would make `exists` throw rather
 * than answer `false`, and `nested/../x` would quietly resolve to `x`. Hiding is
 * therefore decided on the **raw** path, before normalisation — see
 * {@link EscapeHidingFilesApi}. The nature's own paths are constants, so nothing
 * here reaches it today — but the docstring below promises that such a path is
 * hidden, not resolved, and that is worth making true rather than worth trusting.
 */
const ESCAPING_SEGMENT = /(^|\/)\.\.(\/|$)/;

/**
 * A `FilteredFilesApi` that hides any path holding a `..` segment as given, before
 * the base class normalises it. Every operation (`list` entries included) goes
 * through `isHidden`, so this one override covers them all.
 */
class EscapeHidingFilesApi extends FilteredFilesApi {
  constructor(source: FilesApi) {
    super(source, () => true);
  }

  protected override async isHidden(path: string): Promise<boolean> {
    return ESCAPING_SEGMENT.test(path) || (await super.isHidden(path));
  }
}

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
    files = new EscapeHidingFilesApi(new CompositeFilesApi(project.workspace.files, project.path));
    rooted.set(project, files);
  }
  return files;
}
