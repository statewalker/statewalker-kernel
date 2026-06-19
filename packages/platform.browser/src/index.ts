import { getCommands, getUrlStateView } from "@statewalker/platform.core";
import { newRegistry } from "@statewalker/shared-registry";
import { getWorkspace, type LoggerLevel } from "@statewalker/workspace.core";
import { bindUrlState } from "./bind-url-state.js";
import { registerCopyToClipboardBrowser } from "./handlers/copy-to-clipboard.browser.js";
import { registerDownloadBlobBrowser } from "./handlers/download-blob.browser.js";
import { registerDownloadToFilesBrowser } from "./handlers/download-to-files.browser.js";
import { registerPickDirectoryBrowser } from "./handlers/pick-directory.browser.js";
import { registerPickFileBrowser } from "./handlers/pick-file.browser.js";
import { registerPreferenceGetBrowser } from "./handlers/preference-get.browser.js";
import { registerPreferenceSetBrowser } from "./handlers/preference-set.browser.js";
import { registerPinoLogger } from "./pino-logger.browser.js";

export * from "./bind-url-state.js";
export { registerCopyToClipboardBrowser } from "./handlers/copy-to-clipboard.browser.js";
export { registerDownloadBlobBrowser } from "./handlers/download-blob.browser.js";
export { registerDownloadToFilesBrowser } from "./handlers/download-to-files.browser.js";
export { registerPickDirectoryBrowser } from "./handlers/pick-directory.browser.js";
export { registerPickFileBrowser } from "./handlers/pick-file.browser.js";
export { registerPreferenceGetBrowser } from "./handlers/preference-get.browser.js";
export { registerPreferenceSetBrowser } from "./handlers/preference-set.browser.js";
export { PinoLoggerAdapter, registerPinoLogger } from "./pino-logger.browser.js";

/**
 * Register every browser-backed capability for `@statewalker/platform-api`
 * against the context's shared `Commands` bus, and bind the context's
 * `UrlStateView` to `location.hash` so navigation synchronisation activates
 * automatically. Returns a cleanup that unregisters everything in reverse.
 */
const LOG_LEVELS = new Set(["fatal", "error", "warn", "info", "debug", "trace"]);

/** Resolve the workspace log level, opt-in to verbose without a rebuild: `?logLevel=debug`
 * in the URL (highest priority), else `localStorage["statewalker:logLevel"]`, else `info`. */
function resolveLogLevel(): LoggerLevel {
  try {
    const fromUrl = new URLSearchParams(globalThis.location?.search ?? "").get("logLevel");
    if (fromUrl && LOG_LEVELS.has(fromUrl)) return fromUrl as LoggerLevel;
    const stored = globalThis.localStorage?.getItem("statewalker:logLevel");
    if (stored && LOG_LEVELS.has(stored)) return stored as LoggerLevel;
  } catch {
    // location/localStorage may be unavailable (e.g. SSR/tests) — fall through to default.
  }
  return "info";
}

export default function initPlatformWeb(ctx: Record<string, unknown>): () => void {
  const [register, cleanup] = newRegistry();

  const stateView = getUrlStateView(ctx);
  register(bindUrlState(stateView));

  // Pino-backed logging for the workspace model (browser build routes to console).
  // Level is opt-in via `?logLevel=debug` or localStorage — see resolveLogLevel.
  register(registerPinoLogger(getWorkspace(ctx), { level: resolveLogLevel() }));

  const commands = getCommands(ctx);
  register(registerPickDirectoryBrowser(commands));
  register(registerPickFileBrowser(commands));
  register(registerDownloadToFilesBrowser(commands));
  register(registerCopyToClipboardBrowser(commands));
  register(registerDownloadBlobBrowser(commands));
  register(registerPreferenceGetBrowser(commands));
  register(registerPreferenceSetBrowser(commands));

  return cleanup;
}
