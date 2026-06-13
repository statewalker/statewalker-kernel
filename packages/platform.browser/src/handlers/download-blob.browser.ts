import { DownloadBlobCommand } from "@statewalker/platform.core";
import type { Commands } from "@statewalker/shared-commands";

/**
 * Browser default for `platform:download-blob`. Creates a temporary `<a>` with
 * an object URL and synthesises a click. The object URL is revoked after the
 * click fires to avoid leaking the blob reference.
 */
export function registerDownloadBlobBrowser(commands: Commands): () => void {
  return commands.listen(DownloadBlobCommand, (command) => {
    try {
      const { blob, filename } = command.payload;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Revoke after a tick so the browser has time to handle the click.
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 0);
      command.resolve(undefined);
    } catch (error) {
      command.reject(error);
    }
    return true;
  });
}
