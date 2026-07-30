import type { FilesApi } from "@statewalker/webrun-files";
import { type ModuleServer, type ModuleTarget, newModuleServer } from "@statewalker/webrun-modules";

/**
 * The persistent per-project module-server cache (D2): one `newModuleServer`
 * whose `cache` is a `FilesApi` rooted at `<project>/.project/webapp/`. It writes
 * `newModuleServer`'s real layout — `raw/`, `t/<target>/`, `lock.json` — as real
 * files that survive reloads; on a warm cache it reads files only (no transform,
 * no network).
 */

/** The project-relative directory that roots the persistent module-server cache. */
export const WEBAPP_CACHE_ROOT = ".project/webapp";
/** URL-space prefix isolating npm dep URLs from project-module URLs. */
export const WEBAPP_DEPS_PATH = "/deps/";

export interface WebAppModuleServerOptions {
  /** The web-app project's source files (served verbatim as `~/…`). */
  project: FilesApi;
  /** Persistent cache, rooted at `<project>/.project/webapp/`. */
  cache: FilesApi;
  /** Build target. Defaults to `"browser"`. */
  target?: ModuleTarget;
}

/**
 * Build the nature's single, shared module server over the persistent cache with
 * the fixed web-app defaults (`depsPath: "/deps/"`). Reconstructing it over a warm
 * cache re-reads the seeded `lock.json` and serves every module from disk.
 */
export function newWebAppModuleServer(options: WebAppModuleServerOptions): ModuleServer {
  return newModuleServer({
    project: options.project,
    cache: options.cache,
    target: options.target ?? "browser",
    depsPath: WEBAPP_DEPS_PATH,
  });
}
