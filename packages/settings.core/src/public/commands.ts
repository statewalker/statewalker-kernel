import { Command, passthrough } from "@statewalker/shared-commands";

export interface OpenSettingsPayload {
  /** Optional initial tab id. When omitted, the dialog opens to
   * the previously-active tab (or the first tab if none). */
  tabId?: string;
}

/**
 * Open the settings dialog. Default handler lives in
 * `SettingsManager`; consumers fire the command without importing
 * the adapter directly.
 */
export const OpenSettingsCommand = Command.silent("settings:open")
  .input(passthrough<OpenSettingsPayload>())
  .output(passthrough<void>())
  .build();

/** Close the settings dialog. */
export const CloseSettingsCommand = Command.silent("settings:close")
  .input(passthrough<void>())
  .output(passthrough<void>())
  .build();
