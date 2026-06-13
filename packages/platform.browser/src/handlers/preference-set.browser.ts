import { PreferenceSetCommand } from "@statewalker/platform.core";
import type { Commands } from "@statewalker/shared-commands";

const PREFIX = "workbench:";

/**
 * Browser default for `platform:preference-set`. Writes JSON to `localStorage`
 * under the `workbench:` key prefix.
 */
export function registerPreferenceSetBrowser(commands: Commands): () => void {
  return commands.listen(PreferenceSetCommand, (command) => {
    try {
      localStorage.setItem(PREFIX + command.payload.key, JSON.stringify(command.payload.value));
      command.resolve(undefined);
    } catch (error) {
      command.reject(error);
    }
    return true;
  });
}
