import { Command, passthrough } from "@statewalker/shared-commands";
import type { FilesApi } from "@statewalker/webrun-files";

/**
 * Local re-declaration of the `platform:pick-directory` command contract.
 *
 * The workspace-api fragment dispatches this command from `workspace:change`
 * (interactive path) without wanting to depend on `@statewalker/platform-api`
 * — that direction would close the cycle `platform-api → workspace-api →
 * platform-api`. The command is keyed by string, so re-declaring `[run, handle]`
 * here resolves to the same handlers any platform-binding fragment registers.
 */
export const PICK_DIRECTORY_COMMAND_KEY = "platform:pick-directory";

export interface PickDirectoryPayload {
  title?: string;
}

export interface PickDirectoryResult {
  files: FilesApi;
  label: string;
}

export const PickDirectoryCommand = Command.silent(PICK_DIRECTORY_COMMAND_KEY)
  .input(passthrough<PickDirectoryPayload>())
  .output(passthrough<PickDirectoryResult>())
  .build();
