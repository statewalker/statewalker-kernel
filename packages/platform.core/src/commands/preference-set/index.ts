import { Command, passthrough } from "@statewalker/shared-commands";

export const PREFERENCE_SET_COMMAND_KEY = "platform:preference-set";

export interface PreferenceSetPayload {
  key: string;
  value: unknown;
}

export const PreferenceSetCommand = Command.silent(PREFERENCE_SET_COMMAND_KEY)
  .input(passthrough<PreferenceSetPayload>())
  .output(passthrough<void>())
  .build();
