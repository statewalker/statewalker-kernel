import { Command, passthrough } from "@statewalker/shared-commands";

export const COPY_TO_CLIPBOARD_COMMAND_KEY = "platform:copy-to-clipboard";

export interface CopyToClipboardPayload {
  text: string;
}

export const CopyToClipboardCommand = Command.silent(COPY_TO_CLIPBOARD_COMMAND_KEY)
  .input(passthrough<CopyToClipboardPayload>())
  .output(passthrough<void>())
  .build();
