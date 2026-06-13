import { CopyToClipboardCommand } from "@statewalker/platform.core";
import type { Commands } from "@statewalker/shared-commands";

/**
 * Browser default for `platform:copy-to-clipboard`. Uses
 * `navigator.clipboard.writeText`; the call requires a secure context and may
 * fail if the user has not granted clipboard permission — failures reject the
 * command with the underlying error for the caller to surface.
 */
export function registerCopyToClipboardBrowser(commands: Commands): () => void {
  return commands.listen(CopyToClipboardCommand, (command) => {
    void navigator.clipboard
      .writeText(command.payload.text)
      .then(() => {
        command.resolve(undefined);
      })
      .catch((error) => {
        command.reject(error);
      });
    return true;
  });
}
