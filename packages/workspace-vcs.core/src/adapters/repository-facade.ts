import type { Git } from "@statewalker/vcs-commands";
import type { History, SerializationApi } from "@statewalker/vcs-core";
import type { RepositoryFacade } from "@statewalker/vcs-transport";

/** The `History` behind a `Git`, or throw — `Git.history` is `History | undefined`. */
export function historyOf(_git: Git): History {
  throw new Error("not implemented");
}

/**
 * A `SerializationApi` over a `Git`'s history — pack in, pack out.
 *
 * Built here rather than read off the history because **plain `History` has no
 * `serialization` member**; only `HistoryWithOperations` does, and
 * `createGitFilesBackend` returns the plain one. Everything that moves objects
 * across the wire needs this: `exportPack` on push, `importPack` on fetch.
 */
export function serializationOf(_git: Git): SerializationApi {
  throw new Error("not implemented");
}

/** The transport's `RepositoryFacade` over a `Git` — pack export/import for a server. */
export function repositoryFacadeOf(_git: Git): RepositoryFacade {
  throw new Error("not implemented");
}
