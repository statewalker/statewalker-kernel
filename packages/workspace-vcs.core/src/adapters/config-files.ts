import type { ConfigFilesApi } from "@statewalker/vcs-store-files";
import { type FilesApi, tryReadFile } from "@statewalker/webrun-files";

/**
 * Adapt a `FilesApi` to the `ConfigFilesApi` `GitWorkingCopyConfig` expects.
 *
 * The two disagree on shape, not on meaning: `ConfigFilesApi.read` returns a
 * whole `Uint8Array | undefined` and `write` takes one buffer, while `FilesApi`
 * streams — `read` yields an `AsyncIterable<Uint8Array>` and `write` consumes a
 * chunk iterable. Without this shim `new GitWorkingCopyConfig(repoFiles, …)` is
 * a type error, so there is no green path to `.git/config` through it.
 *
 * `undefined` (not an empty buffer) for a missing file is the load-bearing part:
 * `GitWorkingCopyConfig.load()` returns early on a falsy read, and `FilesApi.read`
 * yields *nothing* for a path that does not exist rather than failing — so a shim
 * that just collected chunks would report "present but empty".
 *
 * **A directory counts as absent, and that is the same distinction.** `tryReadFile`
 * gates on `exists()`, which is true for a directory, and then collects zero chunks
 * — so `.git/config` existing as a DIRECTORY yielded a truthy `Uint8Array(0)`,
 * `load()` did not short-circuit, and the next `addHttpRemote` wrote a config
 * assembled from nothing. Reading a directory is not reading an empty file.
 */
export function configFilesOf(files: FilesApi): ConfigFilesApi {
  return {
    read: async (path: string) => {
      const stats = await files.stats(path);
      if (stats?.kind === "directory") return undefined;
      return tryReadFile(files, path);
    },
    write: (path: string, content: Uint8Array) => files.write(path, [content]),
  };
}
