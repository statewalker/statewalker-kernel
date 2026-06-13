import { PreferenceGetCommand } from "@statewalker/platform.core";
import type { Commands } from "@statewalker/shared-commands";

const PREFIX = "workbench:";

/**
 * Browser default for `platform:preference-get`. Reads JSON from `localStorage`
 * under the `workbench:` key prefix. Returns `{ value: undefined }` when the
 * key is absent or parsing fails (the latter is logged but not thrown — the
 * caller gets the "missing value" signal and can re-seed).
 */
export function registerPreferenceGetBrowser(commands: Commands): () => void {
  return commands.listen(PreferenceGetCommand, (command) => {
    try {
      const raw = localStorage.getItem(PREFIX + command.payload.key);
      if (raw === null) {
        command.resolve({ value: undefined });
        return true;
      }
      try {
        command.resolve({ value: JSON.parse(raw) as unknown });
      } catch {
        // Corrupt entry — surface as missing; leave the raw value for manual recovery.
        command.resolve({ value: undefined });
      }
    } catch (error) {
      command.reject(error);
    }
    return true;
  });
}
