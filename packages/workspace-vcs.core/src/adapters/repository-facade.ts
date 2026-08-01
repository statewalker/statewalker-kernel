import type { Git } from "@statewalker/vcs-commands";
// `DefaultSerializationApi` is DECLARED in vcs-core's `backend` barrel, but it must
// be imported from the package ROOT: `@statewalker/vcs-core/backend` maps to
// `dist/backend/index.js`, and vcs-core's build (`rolldown -c && tsc
// --emitDeclarationOnly`) emits exactly one runtime file, `dist/index.js`. The
// subpath therefore resolves for types and fails at runtime with
// `Cannot find package '@statewalker/vcs-core/backend'`.
import {
  DefaultSerializationApi,
  type History,
  type SerializationApi,
} from "@statewalker/vcs-core";
import type { RepositoryFacade } from "@statewalker/vcs-transport";
import { createVcsRepositoryFacade } from "@statewalker/vcs-transport-adapters";

/** The `History` behind a `Git`, or throw — `Git.history` is `History | undefined`. */
export function historyOf(git: Git): History {
  const history = git.history;
  if (!history) throw new Error("git has no history backend");
  return history;
}

/**
 * A `SerializationApi` over a `Git`'s history — pack in, pack out.
 *
 * Built here rather than read off the history because **plain `History` has no
 * `serialization` member**; only `HistoryWithOperations` does, and
 * `createGitFilesBackend` returns the plain one. Everything that moves objects
 * across the wire needs this: `exportPack` on push, `importPack` on fetch — and
 * `PushCommand`'s own `(history as any).serialization` lookup therefore comes back
 * `undefined` on a file-backed repository, which is one more reason the nature
 * drives the transport itself.
 */
export function serializationOf(git: Git): SerializationApi {
  // Narrowed once, at construction — not re-narrowed per call.
  return new DefaultSerializationApi({ history: historyOf(git) });
}

/**
 * The transport's `RepositoryFacade` over a `Git` — pack export/import for a server.
 *
 * The recipe is exactly `{ history, serialization }`; `createVcsRepositoryFacade`
 * delegates `exportPack` to `History.collectReachableObjects` and `importPack` to
 * the `SerializationApi`, so both halves have to be supplied together.
 */
export function repositoryFacadeOf(git: Git): RepositoryFacade {
  const history = historyOf(git);
  return createVcsRepositoryFacade({ history, serialization: serializationOf(git) });
}
