import { Command, passthrough } from "@statewalker/shared-commands";

export const DOWNLOAD_BLOB_COMMAND_KEY = "platform:download-blob";

export interface DownloadBlobPayload {
  blob: Blob;
  filename: string;
}

export const DownloadBlobCommand = Command.async(DOWNLOAD_BLOB_COMMAND_KEY)
  .input(passthrough<DownloadBlobPayload>())
  .output(passthrough<void>())
  .build();
