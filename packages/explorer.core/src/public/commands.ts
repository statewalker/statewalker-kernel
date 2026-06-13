import { Command, passthrough } from "@statewalker/shared-commands";

/**
 * Per the `file-management-split` capability, file-explorer-owned
 * orchestration commands stay namespaced under `file-explorer:*`.
 * Primitive file operations live on `files:*` (in `@statewalker/files`)
 * and SHALL NOT be re-declared here.
 */

export interface RenamePromptPayload {
  path: string;
}
/**
 * Open the rename prompt UI for `path`. Resolves with the new
 * basename on confirm, rejects on cancel. The handler lives in
 * `file-explorer-react` so the panel renderer owns the dialog.
 */
export const RenamePromptCommand = Command.silent("file-explorer:rename-prompt")
  .input(passthrough<RenamePromptPayload>())
  .output(passthrough<{ name: string }>())
  .build();

export interface MkdirPromptPayload {
  parentPath: string;
}
/**
 * Open the mkdir prompt UI under `parentPath`. Resolves with the
 * new directory name on confirm, rejects on cancel.
 */
export const MkdirPromptCommand = Command.silent("file-explorer:mkdir-prompt")
  .input(passthrough<MkdirPromptPayload>())
  .output(passthrough<{ name: string }>())
  .build();

export interface ConfirmDeletePayload {
  paths: string[];
}
/**
 * Open the delete-confirmation dialog. Resolves on confirm, rejects
 * on cancel. The actual deletion is performed by the caller via
 * `files:delete-file`.
 */
export const ConfirmDeleteCommand = Command.silent("file-explorer:confirm-delete")
  .input(passthrough<ConfirmDeletePayload>())
  .output(passthrough<void>())
  .build();

export interface ConfirmCopyMovePayload {
  operation: "copy" | "move";
  sourcePaths: string[];
  targetPath: string;
}
/**
 * Open the copy/move confirmation dialog. Resolves on confirm,
 * rejects on cancel. The caller iterates and dispatches
 * `files:move-file` (move) or single-file copy operations.
 */
export const ConfirmCopyMoveCommand = Command.silent("file-explorer:confirm-copy-move")
  .input(passthrough<ConfirmCopyMovePayload>())
  .output(passthrough<void>())
  .build();

export interface NewFileExplorerPanelPayload {
  /** Initial directory; defaults to `"/"`. */
  initialPath?: string;
  /** Tab/panel label; defaults to `"Files"`. */
  label?: string;
  /**
   * Where to dock relative to the active group. Defaults to `"within"`
   * (open as a tab in the current group); `"left"` / `"right"` create
   * a split.
   */
  position?: "left" | "right" | "within";
}
/**
 * Open a fresh file-explorer panel. Resolves with the new panel id
 * (the suffix after `file-explorer:`) so callers can compose with
 * `dock:focus-panel` etc.
 */
export const NewFileExplorerPanelCommand = Command.silent("file-explorer:new-panel")
  .input(passthrough<NewFileExplorerPanelPayload>())
  .output(passthrough<{ panelId: string }>())
  .build();
