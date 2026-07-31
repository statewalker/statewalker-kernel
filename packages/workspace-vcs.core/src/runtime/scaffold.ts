import { Git } from "@statewalker/vcs-commands";
import { CompositeFilesApi } from "@statewalker/webrun-files-composite";

/**
 * Scaffold self-check. Names the two cross-repo entry points GitNature is built
 * on — the `vcs-commands` command builder and the composite `FilesApi` that
 * roots a repo at its project — and proves both resolved at load time.
 *
 * This exists so the scaffold task has a behaviour of its own; every later task
 * tests real GitNature behaviour instead.
 */
export function vcsScaffoldCheck(): string[] {
  void Git;
  void CompositeFilesApi;
  throw new Error("not implemented");
}
