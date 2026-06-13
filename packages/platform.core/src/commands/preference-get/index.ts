import { Command, passthrough } from "@statewalker/shared-commands";

export const PREFERENCE_GET_COMMAND_KEY = "platform:preference-get";

export interface PreferenceGetPayload {
  key: string;
}

export interface PreferenceGetResult {
  value: unknown | undefined;
}

export const PreferenceGetCommand = Command.silent(PREFERENCE_GET_COMMAND_KEY)
  .input(passthrough<PreferenceGetPayload>())
  .output(passthrough<PreferenceGetResult>())
  .build();
