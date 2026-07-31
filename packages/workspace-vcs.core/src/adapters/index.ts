export { configFilesOf } from "./config-files.js";
export {
  createDuplexGitRemote,
  createHttpGitRemote,
  type DuplexGitRemoteOptions,
  duplexPushOutcome,
  duplexRefspecOf,
  type HttpGitRemoteOptions,
  httpPushOutcome,
  httpRefspecOf,
  type PushTarget,
  pushTargetsOf,
  RemotePushError,
} from "./git-remote.js";
export { refStoreOf } from "./ref-store.js";
export { createGitRepository, trackedFilesOf } from "./repository.js";
export { historyOf, repositoryFacadeOf, serializationOf } from "./repository-facade.js";
export {
  assertSupportedEntry,
  assertSupportedIndex,
  UnsupportedEntryError,
} from "./unsupported-entries.js";
