// Browser ServiceWorker host binding for the web-app nature (webapp-browser-host R1).
//
// `hostApp` is the thin, browser-only adapter over the environment-agnostic
// `buildSiteHandler` (webapp.core, D4): it owns `baseUrl`, feeds it to the
// handler's late-bound `getBaseUrl`, stamps the cross-origin isolation headers
// (R2), and mounts the handler behind `HostedSiteBuilder`'s same-origin SW.

import { buildSiteHandler } from "@statewalker/webapp.core";
import { HostedSiteBuilder } from "@statewalker/webrun-site-host";
import type { Project } from "@statewalker/workspace.core";
import { withIsolationHeaders } from "./isolation-headers.js";

/** Options for {@link hostApp}. */
export interface HostAppOptions {
  /** Service key (first URL segment after the SW scope). Defaults to a random UUID. */
  siteKey?: string;
  /** URL of the ServiceWorker script. Defaults to `HostedSiteBuilder`'s `/sw-worker.js`. */
  serviceWorkerUrl?: string;
  /** Server application context passed to the handler. Defaults to `{ data: <project /data> }`. */
  env?: Record<string, unknown>;
}

/** The running host handle returned by {@link hostApp}. */
export interface HostedApp {
  /** Absolute same-origin site base URL the SW serves the app under. */
  baseUrl: string;
  /** Unmount the site: after this, `baseUrl` no longer serves the app. */
  stop(): Promise<void>;
}

/**
 * Mount a built web-app project behind the same-origin ServiceWorker.
 *
 * Builds the project's `SiteHandler` via `webapp.core`, wraps it with the
 * cross-origin isolation headers, and mounts it with `HostedSiteBuilder` using a
 * late-bound `getBaseUrl` (the runner resolves `${baseUrl}~/<serverEntry>` only
 * after the mount reports its `baseUrl`, as in notes-demo `main.ts`). Returns the
 * mounted `baseUrl` and a `stop()` that tears the mount down.
 */
export async function hostApp(project: Project, opts: HostAppOptions = {}): Promise<HostedApp> {
  let baseUrl = "";
  const handler = await buildSiteHandler(project, {
    getBaseUrl: () => baseUrl,
    ...(opts.env ? { env: opts.env } : {}),
  });

  const builder = new HostedSiteBuilder().setHandler(withIsolationHeaders(handler));
  if (opts.siteKey !== undefined) builder.setSiteKey(opts.siteKey);
  if (opts.serviceWorkerUrl !== undefined) builder.setServiceWorkerUrl(opts.serviceWorkerUrl);

  const site = await builder.build();
  baseUrl = site.baseUrl;

  return {
    baseUrl,
    stop: () => site.stop(),
  };
}
