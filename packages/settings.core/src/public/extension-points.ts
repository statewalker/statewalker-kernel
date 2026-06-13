import { defineSlot } from "@statewalker/shared-slots";
import type { SettingsTab } from "./types.js";

/**
 * `settings:tabs` — `SettingsTab` contributions. The settings-views
 * dialog renders one tab per contribution, sorted by `order`. Each
 * tab's content comes from `ViewRegistry.get(tab.viewKey)`. Plug-in
 * fragments contribute additional tabs without editing the
 * settings core.
 */
export const settingsTabSlot = defineSlot<SettingsTab>("settings:tabs");
