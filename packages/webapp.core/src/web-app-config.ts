import type { FilesApi } from "@statewalker/webrun-files";
import { readText } from "@statewalker/webrun-files";

/**
 * Web-app detection by convention (D6): a project is a web-app iff `package.json`,
 * the client entry, and the server entry all exist at its root. An optional
 * `.project/nature.webapp.json` file overrides the entries, api mount, and watch
 * interval. Pure functions over the project-root `FilesApi` — no side effects.
 */

/** Default client HTML entry (relative to the project root). */
export const DEFAULT_CLIENT_ENTRY = "client/index.html";
/** Default server module entry (relative to the project root). */
export const DEFAULT_SERVER_ENTRY = "server/index.ts";
/** Default mount path for the server runner. */
export const DEFAULT_API_MOUNT = "/api";
/** Default hot-refresh poll interval (ms) when none is configured. */
export const DEFAULT_WATCH_INTERVAL_MS = 1000;
/** Location of the optional override file (relative to the project root). */
export const NATURE_CONFIG_PATH = ".project/nature.webapp.json";

/** The resolved web-app entries + tunables (defaults merged with any override). */
export interface WebAppConfig {
  clientEntry: string;
  serverEntry: string;
  apiMount: string;
  watchInterval: number;
}

/** The result of detection: whether the project is a web-app + its effective config. */
export interface WebAppDetection {
  isWebApp: boolean;
  config: WebAppConfig;
}

/** Read the `.project/nature.webapp.json` override, if present (only known keys). */
async function readOverride(files: FilesApi): Promise<Partial<WebAppConfig>> {
  if (!(await files.exists(`/${NATURE_CONFIG_PATH}`))) return {};
  const raw = JSON.parse(await readText(files, `/${NATURE_CONFIG_PATH}`)) as Record<
    string,
    unknown
  >;
  const out: Partial<WebAppConfig> = {};
  if (typeof raw.clientEntry === "string") out.clientEntry = raw.clientEntry;
  if (typeof raw.serverEntry === "string") out.serverEntry = raw.serverEntry;
  if (typeof raw.apiMount === "string") out.apiMount = raw.apiMount;
  if (typeof raw.watchInterval === "number") out.watchInterval = raw.watchInterval;
  return out;
}

/**
 * Detect whether `files` (rooted at the project) is a web-app and resolve its
 * effective config. `isWebApp` is true iff `package.json` + the (possibly
 * overridden) client and server entries all exist.
 */
export async function resolveWebAppConfig(files: FilesApi): Promise<WebAppDetection> {
  const override = await readOverride(files);
  const config: WebAppConfig = {
    clientEntry: override.clientEntry ?? DEFAULT_CLIENT_ENTRY,
    serverEntry: override.serverEntry ?? DEFAULT_SERVER_ENTRY,
    apiMount: override.apiMount ?? DEFAULT_API_MOUNT,
    watchInterval: override.watchInterval ?? DEFAULT_WATCH_INTERVAL_MS,
  };
  const isWebApp =
    (await files.exists("/package.json")) &&
    (await files.exists(`/${config.clientEntry}`)) &&
    (await files.exists(`/${config.serverEntry}`));
  return { isWebApp, config };
}
