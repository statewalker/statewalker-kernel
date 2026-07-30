import type { FilesApi } from "@statewalker/webrun-files";
import { writeText } from "@statewalker/webrun-files";
import type { ModuleServer, ModuleTarget } from "@statewalker/webrun-modules";
import {
  loggerOf,
  ProjectBuilder,
  type RegisteredBuilder,
  SOURCES_REMOVED_SIGNAL,
  SOURCES_SIGNAL,
} from "@statewalker/workspace.core";
import { deriveLock } from "./derive-lock.js";

/** Signal a `depsBuilder` emits once it has re-seeded `lock.json`. */
export const APP_DEPS_SIGNAL = "app-deps";
/** Signal a `transpileBuilder` emits once it has (re)built the module cache. */
export const APP_MODULES_SIGNAL = "app-modules";
/** Builder id: re-derives the lockfile on a `package.json` change. */
export const DEPS_BUILDER_ID = "WebAppDeps";
/** Builder id: transpiles the reachable `client/**`+`server/**` graph. */
export const TRANSPILE_BUILDER_ID = "WebAppTranspile";

/** JS/TS module files — the only sources the transpile builder acts on. */
const MODULE_EXT = /\.(?:m|c)?[jt]sx?$/;

/** Shared context both builders (and the site handler) close over: one module
 * server + cache + app-source FilesApi per project (D2/D3). */
export interface WebAppBuilderContext {
  /** The app source files, rooted at the project root. */
  appFiles: FilesApi;
  /** The persistent module-server cache, rooted at `<project>/.project/webapp/`. */
  cache: FilesApi;
  /** The single shared module server over `cache` (D2). */
  moduleServer: ModuleServer;
  /** Build target (cache-key namespace under `t/<target>/`). */
  target: ModuleTarget;
  /** Top-level source folder of the client entry (e.g. `client`). */
  clientDir: string;
  /** Top-level source folder of the server entry (e.g. `server`). */
  serverDir: string;
}

/** Is `uri` a JS/TS module under the client or server source folder? */
function isAppModuleSource(uri: string, ctx: WebAppBuilderContext): boolean {
  if (!MODULE_EXT.test(uri)) return false;
  return uri.startsWith(`${ctx.clientDir}/`) || uri.startsWith(`${ctx.serverDir}/`);
}

/**
 * Deps builder (D3): reacts only to a `package.json` change on the `sources` signal,
 * re-derives the exact lockfile, and writes it into the cache as `lock.json` — the
 * cold-build lock seed the transpile prime resolves deps against. Emits `app-deps`
 * so the transpile builder is ordered after a re-lock. In-session dep re-pinning is
 * out of scope: the new pin takes effect on the next session/host start (D3).
 */
export function depsBuilder(ctx: WebAppBuilderContext): RegisteredBuilder {
  return {
    id: DEPS_BUILDER_ID,
    inputs: [SOURCES_SIGNAL],
    outputs: [APP_DEPS_SIGNAL],
    async *handler(project) {
      const builder = project.requireAdapter(ProjectBuilder);
      const log = loggerOf(project, DEPS_BUILDER_ID);
      let stamp: number | undefined;
      for await (const u of builder.readUpdates({
        signal: SOURCES_SIGNAL,
        cell: DEPS_BUILDER_ID,
      })) {
        if (u.uri === "package.json") stamp = u.stamp;
        await u.handled();
      }
      if (stamp !== undefined) {
        const lock = await deriveLock(ctx.appFiles);
        await writeText(ctx.cache, "/lock.json", JSON.stringify(lock));
        log.debug("re-derived lock", { deps: Object.keys(lock).length });
        yield { signal: APP_DEPS_SIGNAL, uri: "package.json", stamp };
      }
      return true;
    },
  };
}

/**
 * Transpile builder (D3): reacts to `client/**`+`server/**` changes (and depends on
 * `app-deps` so a re-lock is ordered first). On a **cold** build it primes each
 * changed module once — walking its reachable graph and pulling/transforming every
 * reachable dep into `t/<target>/`. On an **incremental** edit it does **not** re-prime;
 * it invalidates only the changed module's cache entry (`t/<target>/~/<uri>`) and lets
 * the next `fetch` lazily re-transform it. Cold vs incremental is decided once per run
 * (before any prime writes `t/<target>/`), so a cold batch never deletes what it just built.
 */
export function transpileBuilder(ctx: WebAppBuilderContext): RegisteredBuilder {
  return {
    id: TRANSPILE_BUILDER_ID,
    inputs: [SOURCES_SIGNAL, SOURCES_REMOVED_SIGNAL, APP_DEPS_SIGNAL],
    outputs: [APP_MODULES_SIGNAL],
    async *handler(project) {
      const builder = project.requireAdapter(ProjectBuilder);
      const log = loggerOf(project, TRANSPILE_BUILDER_ID);
      // Drain the `app-deps` barrier (ordering only — the lock is already on disk).
      for await (const u of builder.readUpdates({
        signal: APP_DEPS_SIGNAL,
        cell: TRANSPILE_BUILDER_ID,
      })) {
        await u.handled();
      }
      // Cold iff nothing has been transformed yet — captured before any prime writes.
      const isCold = !(await ctx.cache.exists(`/t/${ctx.target}`));
      let stamp: number | undefined;
      for await (const u of builder.readUpdates({
        signal: SOURCES_SIGNAL,
        cell: TRANSPILE_BUILDER_ID,
      })) {
        if (isAppModuleSource(u.uri, ctx)) {
          try {
            if (isCold) {
              await ctx.moduleServer.prime({ url: `/${u.uri}` });
            } else {
              await ctx.cache.remove(`/t/${ctx.target}/~/${u.uri}`);
            }
          } catch (error) {
            // A failed prime is NOT a converged build: leave this update un-handled
            // (a rescan retries it) and rethrow so `ProjectBuilder.run()` surfaces the
            // failure — `scan()` must not report success while a module went unbuilt.
            log.error("transpile failed", {
              uri: u.uri,
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          }
          stamp = u.stamp;
        }
        await u.handled();
      }
      // A removed source's transform is stale: drop its cache entry so the warm module
      // server no longer serves the deleted module's old body (design D3 covered only
      // content edits; deletion is handled here).
      for await (const u of builder.readUpdates({
        signal: SOURCES_REMOVED_SIGNAL,
        cell: TRANSPILE_BUILDER_ID,
      })) {
        if (isAppModuleSource(u.uri, ctx)) {
          const entry = `/t/${ctx.target}/~/${u.uri}`;
          if (await ctx.cache.exists(entry)) await ctx.cache.remove(entry);
          stamp = u.stamp;
        }
        await u.handled();
      }
      if (stamp !== undefined) yield { signal: APP_MODULES_SIGNAL, uri: "app", stamp };
      return true;
    },
  };
}
