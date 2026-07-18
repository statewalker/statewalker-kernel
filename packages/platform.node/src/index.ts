import { homedir } from "node:os";
import {
  getCommands,
  PreferenceGetCommand,
  PreferenceSetCommand,
} from "@statewalker/platform.core";
import { newRegistry } from "@statewalker/shared-registry";
import { type FilesApi, readText, writeText } from "@statewalker/webrun-files";
import { NodeFilesApi } from "@statewalker/webrun-files-node";

/** All host preferences live in one JSON object file at the config root. */
const PREFS_FILE = "/preferences.json";

/** `$XDG_CONFIG_HOME/statewalker` or `~/.config/statewalker` — the host config dir. */
function defaultConfigDir(): string {
  const base = process.env.XDG_CONFIG_HOME || `${homedir()}/.config`;
  return `${base}/statewalker`;
}

/** Read the preferences object; missing or corrupt file → empty (mirrors the browser "missing" fallback). */
async function readPrefs(files: FilesApi): Promise<Record<string, unknown>> {
  if (!(await files.stats(PREFS_FILE))) return {};
  try {
    return JSON.parse(await readText(files, PREFS_FILE)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export interface PlatformNodeOptions {
  /**
   * FilesApi holding host-scoped durable preferences (one JSON object file).
   * Defaults to a `NodeFilesApi` rooted at `$XDG_CONFIG_HOME/statewalker`
   * (or `~/.config/statewalker`). Inject a `MemFilesApi` in tests.
   */
  preferences?: FilesApi;
}

/**
 * Node implementation of the `platform:*` capability surface. Registers durable
 * `platform:preference-get/set`, backed by a `FilesApi` (default: a
 * `NodeFilesApi` at the host config dir) — no `node:fs` in the handler bodies.
 *
 * Browser-only capabilities — pickers, clipboard, download-blob, url-state
 * binding — are not applicable on a server and stay unregistered; a headless
 * caller of those gets a `no-handlers` outcome, the honest "unavailable" signal.
 */
export default function initPlatformNode(
  ctx: Record<string, unknown>,
  opts?: PlatformNodeOptions,
): () => void {
  const files = opts?.preferences ?? new NodeFilesApi({ rootDir: defaultConfigDir() });
  const commands = getCommands(ctx);
  const [register, cleanup] = newRegistry();

  register(
    commands.listen(PreferenceGetCommand, (command) =>
      readPrefs(files).then((prefs) => ({ value: prefs[command.payload.key] })),
    ),
  );
  register(
    commands.listen(PreferenceSetCommand, (command) =>
      readPrefs(files).then((prefs) => {
        prefs[command.payload.key] = command.payload.value;
        return writeText(files, PREFS_FILE, JSON.stringify(prefs, null, 2));
      }),
    ),
  );

  return cleanup;
}
