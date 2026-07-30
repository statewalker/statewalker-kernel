// Open-command logic fragment (React-free — ADR-0002 placement override): given a web-app
// project and an INJECTED host boundary (a `hostApp`-shaped function, passed in rather than a
// direct import of the ServiceWorker binding), it hosts the app, builds a dock spec carrying
// the hosted `baseUrl` + client entry, and fires `ShowDockPanelCommand` — opening (or
// focusing) the app as a dockview tab through the shell's existing dock host. The injected
// boundary keeps this node-testable with no ServiceWorker (webapp-dock-view R1).

import type { SpecStore } from "@statewalker/render.core";
import { Command, type Commands, passthrough } from "@statewalker/shared-commands";
import { ShowDockPanelCommand } from "@statewalker/shell.core";
import { appFilesOf, resolveWebAppConfig } from "@statewalker/webapp.core";
import type { Project } from "@statewalker/workspace.core";
import {
  makeSiteFrameSpec,
  WEBAPP_DOCK_CATALOG_ID,
  webAppPanelId,
  webAppSpecId,
} from "./dock-catalog.js";
import type { HostedApp } from "./host-app.js";

export interface OpenWebAppPayload {
  /** The web-app project to host and open as a dock tab. */
  project: Project;
}

/** Command: host `project` and open (or focus) its web-app dock tab. */
export const OpenWebAppCommand = Command.silent("webapp:open")
  .input(passthrough<OpenWebAppPayload>())
  .output(passthrough<void>())
  .build();

/** The injected host boundary — structurally `hostApp` from this package. */
export type HostAppFn = (project: Project) => Promise<HostedApp>;

export interface RegisterOpenWebAppOptions {
  commands: Commands;
  store: SpecStore;
  /** Injected host boundary (pass `hostApp`); kept indirect for node-testability. */
  host: HostAppFn;
}

/**
 * Register the `webapp:open` handler. The command is open-**or-focus**, so it hosts a given
 * project's SW site **only on its first open**: the `HostedApp` is captured in a per-panel map,
 * and any re-dispatch reuses that existing mount + persistent spec and just fires
 * `ShowDockPanelCommand` (which focuses the already-open tab) — never mounting a second site.
 * Returns a disposer that removes the listener and `stop()`s every hosted mount.
 */
export function registerOpenWebApp({
  commands,
  store,
  host,
}: RegisterOpenWebAppOptions): () => void {
  // Apps hosted in this session, keyed by panelId. The value is the IN-FLIGHT (or resolved)
  // `host()` promise: it is reserved synchronously on the first dispatch — before any await — so a
  // concurrent second dispatch for the same project observes it and reuses the single mount + spec
  // instead of racing to mount a second SW site (the leak). A rejected mount is evicted so a later
  // dispatch can retry.
  const hosted = new Map<string, Promise<HostedApp>>();

  const dispose = commands.listen(OpenWebAppCommand, (cmd) => {
    void (async () => {
      const { project } = cmd.payload;
      const panelId = webAppPanelId(project.path);
      const specId = webAppSpecId(project.path);
      if (!hosted.has(panelId)) {
        // Reserve the mount synchronously (no await between has() and set()) so a concurrent
        // dispatch sees it and skips its own host() call.
        const pending = host(project);
        hosted.set(panelId, pending);
        pending.catch(() => {
          if (hosted.get(panelId) === pending) hosted.delete(panelId);
        });
        const app = await pending;
        const { config } = await resolveWebAppConfig(appFilesOf(project));
        if (!store.get(specId)) {
          store.create({
            id: specId,
            catalogId: WEBAPP_DOCK_CATALOG_ID,
            // The hosted site serves project files under the `~/` URL prefix (deps
            // live under `deps/`), so the baseUrl-relative client entry is
            // `~/<clientEntry>` — see webrun-site-host / notes-demo.
            spec: makeSiteFrameSpec({
              baseUrl: app.baseUrl,
              clientEntry: `~/${config.clientEntry}`,
            }),
            meta: { persistent: true },
          });
        }
      }
      await commands.call(ShowDockPanelCommand, {
        panelId,
        specId,
      }).promise;
      cmd.resolve();
    })().catch((error: unknown) => cmd.reject(error));
    return true;
  });

  return () => {
    dispose();
    // Values are the (possibly still in-flight) host() promises; stop each mount once it resolves.
    for (const pending of hosted.values()) void pending.then((app) => app.stop());
    hosted.clear();
  };
}
