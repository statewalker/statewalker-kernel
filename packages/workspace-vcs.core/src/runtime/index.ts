export { type OpenGitRepoOptions, openGitRepo } from "./git-assembly.js";
export { repoFilesOf } from "./repo-files.js";
export {
  type AddHttpRemoteOptions,
  type Author,
  type CommitInfo,
  type CommitOptions,
  type CommitOutcome,
  type FetchFn,
  type PushOptions,
  registerVcs,
  type VcsDeps,
  VcsNature,
  type VcsRemotes,
  vcsNatureOf,
} from "./vcs-nature.js";
