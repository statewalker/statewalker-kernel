import { Git } from "@statewalker/vcs-commands";
import type { FilesApi } from "@statewalker/vcs-core";
import {
  createFileWorktree,
  createGitFilesBackend,
  FileStagingStore,
} from "@statewalker/vcs-store-files";
import { createMemoryCheckout, createMemoryWorkingCopy } from "@statewalker/vcs-working-tree";

/** Where the repository lives inside the project — a real, native-readable `.git`. */
const GIT_DIR = ".git";

/**
 * The one branch this nature initializes.
 *
 * NOT a parameter, deliberately: `createMemoryWorkingCopy` hardcodes
 * `headRef = "refs/heads/main"` and never reads `.git/HEAD`. Initialize any other
 * default branch and a reopened repository resolves the wrong ref — the on-disk HEAD
 * says one thing and the working copy another, silently.
 */
const DEFAULT_BRANCH = "main";

/** How {@link openGitRepo} should treat a `.git` that is not there yet. */
export interface OpenGitRepoOptions {
  /** `true` — lay down a fresh `.git` layout; `false` — open what is already on disk. */
  create: boolean;
}

/**
 * Assemble a **file-backed** `Git` over `files`: objects under `.git/objects`, refs
 * under `.git/refs`, HEAD at `.git/HEAD` — a repository native git can read, and one
 * that survives the process that wrote it.
 *
 * This explicit assembly is the whole point, and `Git.init()…call()` is not a
 * shorthand for it. `InitCommand` hardwires `createMemoryHistory()` and never touches
 * `createGitFilesBackend`; the `FilesApi` handed to it reaches only the worktree and
 * the staging store, and `setGitDir(".git")` is a string echoed back in the result.
 * Through that path a commit leaves `.git/index` on disk and lives entirely in RAM.
 *
 * `create` is likewise not optional-by-default: `InitCommand` performs no existence
 * check and unconditionally overwrites HEAD, so "init" and "open" are genuinely two
 * calls here — `create: true` lays the layout down, `create: false` reads it back.
 * The caller decides by asking whether `.git/HEAD` exists.
 *
 * No `refs.setSymbolic("HEAD", …)` is needed: the create path writes
 * `.git/HEAD = ref: refs/heads/main` itself, and `History.initialize()` sets HEAD only
 * when it is absent.
 */
export async function openGitRepo(files: FilesApi, options: OpenGitRepoOptions): Promise<Git> {
  const { history } = await createGitFilesBackend({
    files,
    gitDir: GIT_DIR,
    create: options.create,
    defaultBranch: DEFAULT_BRANCH,
  });
  await history.initialize();

  // The native `.git/index`, so the staging area is the one git itself would read.
  // `read()` is unconditional: on a fresh repository it finds no file and does not
  // throw, so an exists-guard here would only be noise.
  const staging = new FileStagingStore(files, `${GIT_DIR}/index`);
  await staging.read();

  const checkout = createMemoryCheckout({ staging });
  // `gitDir` is what makes the worktree read `.git/info/exclude` — see `VcsNature.init`.
  const worktree = createFileWorktree({
    files,
    rootPath: "",
    blobs: history.blobs,
    trees: history.trees,
    gitDir: GIT_DIR,
  });

  return Git.fromWorkingCopy(createMemoryWorkingCopy({ history, checkout, worktree }));
}
