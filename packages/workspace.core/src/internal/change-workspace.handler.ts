import type { Commands } from "@statewalker/shared-commands";
import type { FilesApi } from "@statewalker/webrun-files";
import { ChangeWorkspaceCommand } from "../public/commands.js";
import { initWorkspace } from "../public/init-workspace.js";
import { PickDirectoryCommand } from "../public/pick-directory.js";
import type { Workspace } from "../public/types/workspace.js";

/**
 * Register the `workspace:change` handler.
 *
 * Two activation paths share this handler:
 *   1. Non-interactive: `commands.call(ChangeWorkspaceCommand, { files, label? })` —
 *      the handler skips the dialog and rebinds the workspace to the
 *      supplied `FilesApi` directly. Used by tests, the integration
 *      harness, the `?fs=mem` shortcut, and any non-UI caller.
 *   2. Interactive: `commands.call(ChangeWorkspaceCommand, {})` — the handler fires
 *      `platform:pick-directory` and awaits the user's choice.
 *      Cancel/dismiss rejects the command with `UserCancelledError`.
 *
 * Both paths preserve workspace identity by performing
 * `await close → setFileSystem → await open` in that order so adapters
 * bound to the previous `FilesApi` are torn down before the new one is
 * opened.
 */
export function registerChangeWorkspaceHandler({
  commands,
  workspace,
}: {
  commands: Commands;
  workspace: Workspace;
}): () => void {
  return commands.listen(ChangeWorkspaceCommand, (command) => {
    void (async () => {
      let newFiles: FilesApi;
      let newLabel: string | undefined;
      if (command.payload.files) {
        newFiles = command.payload.files;
        newLabel = command.payload.label;
      } else {
        const picked = await commands.call(PickDirectoryCommand, {
          title: "Change workspace folder",
        }).promise;
        newFiles = picked.files;
        newLabel = picked.label;
      }
      await workspace.close();
      initWorkspace({ workspace, filesApi: newFiles, label: newLabel });
      await workspace.open();
      return workspace;
    })()
      .then((workspace) => {
        command.resolve({ workspace });
      })
      .catch((error) => {
        command.reject(error);
      });
    return true;
  });
}
