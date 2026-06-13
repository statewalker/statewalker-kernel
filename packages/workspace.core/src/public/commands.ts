import { Command, passthrough } from "@statewalker/shared-commands";
import type { FilesApi } from "@statewalker/webrun-files";
import type { Workspace } from "./types/workspace.js";

export const CHANGE_WORKSPACE_COMMAND_KEY = "workspace:change";

export interface ChangeWorkspacePayload {
  /**
   * When supplied, the handler skips the dialog and rebinds the workspace
   * to this `FilesApi` directly. Used by tests, the integration harness,
   * the `?fs=mem` shortcut, and any non-interactive caller (CLI, MCP).
   *
   * When absent, the handler opens the unified request-file-system dialog
   * via `publishDialog(ctx, view)` and resolves the user's choice.
   */
  files?: FilesApi;
  /**
   * Free-form label shown in the workspace UI. Defaults to `"Workspace"`
   * when `files` is supplied without a label, and to the directory name
   * when the user picks via the dialog.
   */
  label?: string;
}

export interface ChangeWorkspaceResult {
  workspace: Workspace;
}

export const ChangeWorkspaceCommand = Command.silent(CHANGE_WORKSPACE_COMMAND_KEY)
  .input(passthrough<ChangeWorkspacePayload>())
  .output(passthrough<ChangeWorkspaceResult>())
  .build();
