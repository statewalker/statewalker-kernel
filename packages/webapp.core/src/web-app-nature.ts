import { SiteBuilder, type SiteHandler } from "@statewalker/webrun-site-builder";
import { newServerRunner } from "@statewalker/webrun-site-host";
import {
  type PollScheduler,
  type Project,
  ProjectAdapter,
  ProjectBuilder,
  ProjectWatcher,
  type Workspace,
} from "@statewalker/workspace.core";
import { appFilesOf, cacheFilesOf, dataFilesOf } from "./prefix-files-api.js";
import { depsBuilder, transpileBuilder, type WebAppBuilderContext } from "./web-app-builders.js";
import { resolveWebAppConfig, type WebAppConfig } from "./web-app-config.js";
import { newWebAppModuleServer } from "./web-app-module-server.js";

/** Drive a build generator to completion. */
async function drain(gen: AsyncGenerator<unknown>): Promise<void> {
  for await (const _ of gen) {
    /* consume */
  }
}

/** Top-level source folder of an entry path (`client/index.html` → `client`). */
function topDir(entry: string): string {
  return entry.split("/")[0] ?? "";
}

/** A running hot-refresh subscription: the watcher, a stop, and an idle barrier. */
export interface HotRefreshHandle {
  /** The underlying watcher (already started). */
  watcher: ProjectWatcher;
  /** Halt watcher-driven rebuilds. */
  stop(): void;
  /** Resolve once the currently-scheduled rebuild (if any) has settled. */
  whenIdle(): Promise<void>;
}

/** Options for `buildSiteHandler`. */
export interface BuildSiteHandlerOptions {
  /** Late-bound host base URL (the runner imports `${baseUrl}~/<serverEntry>`). */
  getBaseUrl: () => string;
  /** Server application context. Defaults to `{ data: <project /data FilesApi> }`. */
  env?: Record<string, unknown>;
}

/**
 * The web-app nature of a project, as a façade project adapter (like `WikiNature`):
 * `exists()` (is this a web-app), `build()`/`scan()` (register both builders on
 * `ProjectBuilder` and run the full pipeline into the persistent `.project/webapp/`
 * cache), and `startHotRefresh()` (watcher-driven rebuilds). The environment-agnostic
 * `SiteHandler` is produced by the standalone `buildSiteHandler` (D4).
 */
export class WebAppNature extends ProjectAdapter {
  /** Whether this project carries the web-app nature (convention or override). */
  async exists(): Promise<boolean> {
    return (await resolveWebAppConfig(appFilesOf(this.project))).isWebApp;
  }

  /** Resolve the per-project build context, or `undefined` if not a web-app. */
  private async context(): Promise<(WebAppBuilderContext & { config: WebAppConfig }) | undefined> {
    const appFiles = appFilesOf(this.project);
    const { isWebApp, config } = await resolveWebAppConfig(appFiles);
    if (!isWebApp) return undefined;
    const cache = cacheFilesOf(this.project);
    const moduleServer = newWebAppModuleServer({ project: appFiles, cache });
    return {
      appFiles,
      cache,
      moduleServer,
      target: "browser",
      clientDir: topDir(config.clientEntry),
      serverDir: topDir(config.serverEntry),
      config,
    };
  }

  /** Register the two builders on the project's `ProjectBuilder` (idempotent by id). */
  private registerBuilders(ctx: WebAppBuilderContext): ProjectBuilder {
    const builder = this.project.requireAdapter(ProjectBuilder);
    builder.registerBuilder(depsBuilder(ctx));
    builder.registerBuilder(transpileBuilder(ctx));
    return builder;
  }

  /**
   * Register the builders and run a full pipeline to convergence, populating the
   * persistent `.project/webapp/` cache. A no-op on a non-web-app project (registers
   * no builders, writes nothing) and on an unchanged rescan (the scanner detects no
   * source change).
   */
  async build(): Promise<void> {
    const ctx = await this.context();
    if (!ctx) return;
    await drain(this.registerBuilders(ctx).run());
  }

  /** Alias of `build()` — mirrors the wiki nature's `scan()` entry point. */
  scan(): Promise<void> {
    return this.build();
  }

  /**
   * Start watcher-driven hot rebuilds (D7): subscribe the client + server source
   * folders and `package.json` to a `ProjectWatcher` at the configured interval; any
   * matched change fires a full `ProjectBuilder.run()`. No-op on a non-web-app project.
   */
  async startHotRefresh(opts?: {
    scheduler?: PollScheduler;
  }): Promise<HotRefreshHandle | undefined> {
    const ctx = await this.context();
    if (!ctx) return undefined;
    const builder = this.registerBuilders(ctx);
    const watcher = this.project.requireAdapter(ProjectWatcher).configure({
      scheduler: opts?.scheduler,
      defaultIntervalMs: ctx.config.watchInterval,
    });
    let building = Promise.resolve();
    const trigger = () => {
      building = building.then(() => drain(builder.run())).catch(() => {});
    };
    watcher.watch(`${ctx.clientDir}/**`, trigger);
    watcher.watch(`${ctx.serverDir}/**`, trigger);
    watcher.watch("package.json", trigger);
    watcher.start(ctx.config.watchInterval);
    return { watcher, stop: () => watcher.stop(), whenIdle: () => building };
  }
}

/** Register the web-app nature façade as a project adapter on `workspace`. */
export function registerWebApp(workspace: Workspace): void {
  workspace.adaptersRegistry.register(
    "project",
    WebAppNature,
    (project) => new WebAppNature(project),
  );
}

/** Resolve the web-app nature façade from a project. */
export function webAppNatureOf(project: Project): WebAppNature {
  return project.requireAdapter(WebAppNature);
}

/**
 * Build the environment-agnostic `SiteHandler` (D4): `/api/*` → `newServerRunner`
 * (dynamic-importing `${baseUrl}~/<serverEntry>` with the injected `env`, default
 * `{ data: <project /data FilesApi> }`), and every other path → the warm module
 * server over the persistent cache. No ServiceWorker or specific host involved.
 */
export async function buildSiteHandler(
  project: Project,
  opts: BuildSiteHandlerOptions,
): Promise<SiteHandler> {
  const appFiles = appFilesOf(project);
  const { config } = await resolveWebAppConfig(appFiles);
  const cache = cacheFilesOf(project);
  const moduleServer = newWebAppModuleServer({ project: appFiles, cache });
  const env = opts.env ?? { data: dataFilesOf(project) };
  return new SiteBuilder()
    .setEndpoint(
      `${config.apiMount}/*`,
      newServerRunner(`/~/${config.serverEntry}`, opts.getBaseUrl, env),
    )
    .setEndpoint("/*", (request) => moduleServer.fetch(request))
    .build();
}
