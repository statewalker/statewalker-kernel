import { Command, passthrough } from "@statewalker/shared-commands";

/**
 * Re-export the canonical `workspace:change` command from
 * `@statewalker/workspace`. Callers that want to switch /
 * connect / set the workspace folder fire
 * `commands.call(ChangeWorkspaceCommand, { files? })`.
 *
 * `commands.call(ChangeWorkspaceCommand, {})` opens the picker dialog
 * interactively (defers to platform-api's PickDirectoryCommand);
 * `commands.call(ChangeWorkspaceCommand, { files })` rebinds non-interactively
 * (used by tests, integration harness, future CLI / MCP entry points).
 */
export {
  ChangeWorkspaceCommand,
  type ChangeWorkspacePayload,
  type ChangeWorkspaceResult,
} from "@statewalker/workspace.core";

/**
 * Empty payload type used by both reconnect/disconnect — neither
 * command carries data; both act on the currently-stored handle.
 */
export type WorkspaceVoidPayload = Record<string, never>;
export type WorkspaceVoidResult = Record<string, never>;

/**
 * `workspace:reconnect` — re-request permission on the currently
 * stored directory handle. On `granted` the manager internally fires
 * `runChangeWorkspace`; on `denied` it transitions to `empty`. Must
 * be fired from a user gesture so the underlying
 * `requestPermission()` call is allowed by the browser.
 */
export const WORKSPACE_RECONNECT_COMMAND_KEY = "workspace:reconnect";
export const WorkspaceReconnectCommand = Command.silent(WORKSPACE_RECONNECT_COMMAND_KEY)
  .input(passthrough<WorkspaceVoidPayload>())
  .output(passthrough<WorkspaceVoidResult>())
  .build();

/**
 * `workspace:disconnect` — `await workspace.close()`, clear the
 * persisted handle in IndexedDB, and transition the
 * `WorkspaceShellAdapter` to `empty`. Used by the "Switch workspace"
 * header item before firing `workspace:change` so the previous
 * runtime is fully torn down before the next pick lands.
 */
export const WORKSPACE_DISCONNECT_COMMAND_KEY = "workspace:disconnect";
export const WorkspaceDisconnectCommand = Command.silent(WORKSPACE_DISCONNECT_COMMAND_KEY)
  .input(passthrough<WorkspaceVoidPayload>())
  .output(passthrough<WorkspaceVoidResult>())
  .build();
