import { PickDirectoryCommand, UserCancelledError } from "@statewalker/platform.core";
import type { Commands } from "@statewalker/shared-commands";
import { BrowserFilesApi } from "@statewalker/webrun-files-browser";

/** Minimal shape of the File System Access API we rely on. Chrome/Edge only. */
interface DirectoryPickerGlobal {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
  }) => Promise<FileSystemDirectoryHandle>;
}

/**
 * Browser default for `platform:pick-directory`. Invokes the File System Access
 * API's directory picker, wraps the returned handle into a `BrowserFilesApi`,
 * and surfaces the directory's `name` as the label. Persistence of the handle
 * is explicitly NOT done here — callers that want to remember a workspace
 * use the `platform:preference-*` commands with a serialisable identifier.
 */
export function registerPickDirectoryBrowser(commands: Commands): () => void {
  return commands.listen(PickDirectoryCommand, (command) => {
    const api = globalThis as unknown as DirectoryPickerGlobal;
    const picker = api.showDirectoryPicker;
    if (typeof picker !== "function") {
      command.reject(new Error("showDirectoryPicker is not available in this environment"));
      return true;
    }

    picker({ mode: "readwrite" })
      .then((handle) => {
        const files = new BrowserFilesApi({ rootHandle: handle });
        command.resolve({ files, label: handle.name });
      })
      .catch((error: unknown) => {
        command.reject(isAbortError(error) ? new UserCancelledError() : error);
      });
    return true;
  });
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}
