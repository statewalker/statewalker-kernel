import type { Git } from "@statewalker/vcs-commands";
import type { FilesApi } from "@statewalker/vcs-core";

/** How {@link openGitRepo} should treat a `.git` that is not there yet. */
export interface OpenGitRepoOptions {
  /** `true` — lay down a fresh `.git` layout; `false` — open what is already on disk. */
  create: boolean;
}

/** Assemble a file-backed `Git` over `files`. */
export function openGitRepo(_files: FilesApi, _options: OpenGitRepoOptions): Promise<Git> {
  throw new Error("not implemented");
}
