export { type OpenGitRepoOptions, openGitRepo } from "./git-assembly.js";
export { repoFilesOf } from "./repo-files.js";
export {
  type Author,
  type CommitInfo,
  type CommitOptions,
  type CommitOutcome,
  type FetchFn,
  registerVcs,
  type VcsDeps,
  VcsNature,
  vcsNatureOf,
} from "./vcs-nature.js";
