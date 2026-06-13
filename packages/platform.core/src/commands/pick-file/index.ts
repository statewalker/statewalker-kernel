import { Command, passthrough } from "@statewalker/shared-commands";

export const PICK_FILE_COMMAND_KEY = "platform:pick-file";

export interface PickFilePayload {
  title?: string;
  accept?: string[];
  multiple?: boolean;
}

export interface PickFileResult {
  blobs: Blob[];
  names: string[];
}

export const PickFileCommand = Command.silent(PICK_FILE_COMMAND_KEY)
  .input(passthrough<PickFilePayload>())
  .output(passthrough<PickFileResult>())
  .build();
