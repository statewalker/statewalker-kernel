import { Command, passthrough } from "@statewalker/shared-commands";
import type { FilesApi } from "@statewalker/webrun-files";

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
