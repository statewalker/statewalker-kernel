import { Command, passthrough } from "@statewalker/shared-commands";
import type { PanelPosition } from "./types.js";

export interface ShowDockPanelPayload {
  panelId: string;
  specId: string;
  position?: PanelPosition;
  /**
   * Panel id to open relative to. When set together with `position`,
   * the new panel docks `position` of THIS panel rather than the
   * currently-active group. Without `position`, the panel is added
   * `"within"` the reference's group as an additional tab. Falls
   * back silently to the default placement if no panel with this id
   * is currently open.
   */
  referencePanelId?: string;
  /** Optional initial tab title; defaults to `panelId` if omitted. */
  title?: string;
  activate?: boolean;
}

/**
 * The payload deliberately omits any DockView `component` field
 * (vision audit C7 / proposal §5.5) — the dock fragment is the only
 * place that knows the panel kind is `"json"`.
 */
export const ShowDockPanelCommand = Command.silent("dock:show-panel")
  .input(passthrough<ShowDockPanelPayload>())
  .output(passthrough<void>())
  .build();

export interface ClosePanelPayload {
  panelId: string;
}
export const ClosePanelCommand = Command.silent("dock:close-panel")
  .input(passthrough<ClosePanelPayload>())
  .output(passthrough<void>())
  .build();

export interface FocusPanelPayload {
  panelId: string;
}
export const FocusPanelCommand = Command.silent("dock:focus-panel")
  .input(passthrough<FocusPanelPayload>())
  .output(passthrough<void>())
  .build();

export interface SetPanelTitlePayload {
  panelId: string;
  title: string;
}
/**
 * Sets the tab title shown in DockView's tab bar. No-op when the
 * panel is not open. Generic across panel kinds — chat tabs, future
 * file tabs, etc. — so the dock fragment owns the mechanism rather
 * than each catalog reinventing it.
 */
export const SetPanelTitleCommand = Command.silent("dock:set-panel-title")
  .input(passthrough<SetPanelTitlePayload>())
  .output(passthrough<void>())
  .build();
