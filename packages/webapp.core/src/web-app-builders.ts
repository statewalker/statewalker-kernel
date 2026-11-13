import type { FilesApi } from "@statewalker/webrun-files";
import { writeText } from "@statewalker/webrun-files";
import type { ModuleServer, ModuleTarget } from "@statewalker/webrun-modules";
import { loggerOf, type RegisteredBuilder, SOURCES_COLLECTION } from "@statewalker/workspace.core";
import { deriveLock } from "./derive-lock.js";

/** Collection the deps builder writes once it has re-seeded `lock.json`. */
export const APP_DEPS_COLLECTION = "app-deps";
/** Collection the transpile builder writes per (re)built app module. */
export const APP_MODULES_COLLECTION = "app-modules";
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
 * Deps builder (D3): one task per source; only `package.json` does work. It re-derives
 * the exact lockfile and writes it into the cache as `lock.json` — the cold-build lock
 * seed the transpile prime resolves deps against — and emits the lock's text as
 * `app-deps/package.json`, so the row changes only when the lock does. In-session dep
 * re-pinning is out of scope: the new pin takes effect on the next session (D3).
 */
export function depsBuilder(ctx: WebAppBuilderContext): RegisteredBuilder {
  return {
    id: DEPS_BUILDER_ID,
    inputs: [SOURCES_COLLECTION],
    outputs: [APP_DEPS_COLLECTION],
    async run(task, project) {
      if (task.key !== "package.json") return;
      const lock = await deriveLock(ctx.appFiles);
      const text = JSON.stringify(lock);
      await writeText(ctx.cache, "/lock.json", text);
      loggerOf(project, DEPS_BUILDER_ID).debug("re-derived lock", {
        deps: Object.keys(lock).length,
      });
      task.emit(APP_DEPS_COLLECTION, "package.json", text);
    },
  };
}

/**
 * Transpile builder (D3): one task per `client/**`+`server/**` module. It drops the
 * module's cache entry (`t/<target>/~/<uri>`) and primes it: on a cold cache the prime
 * walks the module's reachable graph and pulls/transforms every dep into `t/<target>/`;
 * on an edit only the changed module is re-transformed (the rest are cache hits).
 * `reads: ["app-deps"]` orders it after a re-lock without depending on the lock's
 * value. A removed module's cache entry is dropped by `dispose`, so the warm module
 * server no longer serves the deleted module's old body. A failed prime fails the task
 * (retried, then reported by `ProjectBuilder.run()`).
 */
export function transpileBuilder(ctx: WebAppBuilderContext): RegisteredBuilder {
  const entry = (uri: string) => `/t/${ctx.target}/~/${uri}`;
  return {
    id: TRANSPILE_BUILDER_ID,
    inputs: [SOURCES_COLLECTION],
    reads: [APP_DEPS_COLLECTION],
    outputs: [APP_MODULES_COLLECTION],
    async run(task, project) {
      if (!isAppModuleSource(task.key, ctx)) return;
      const fingerprint = await task.get(SOURCES_COLLECTION, task.key);
      try {
        if (await ctx.cache.exists(entry(task.key))) await ctx.cache.remove(entry(task.key));
        await ctx.moduleServer.prime({ url: `/${task.key}` });
      } catch (error) {
        loggerOf(project, TRANSPILE_BUILDER_ID).error("transpile failed", {
          uri: task.key,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      task.emit(APP_MODULES_COLLECTION, task.key, fingerprint ?? null);
    },
    async dispose(key) {
      if (!isAppModuleSource(key, ctx)) return;
      if (await ctx.cache.exists(entry(key))) await ctx.cache.remove(entry(key));
    },
  };
}
