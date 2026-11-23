import { defineSlot } from "@statewalker/shared-slots";
import type { ComponentType } from "react";

/**
 * `dock:tab-icons` — per-prefix tab icon contributions.
 *
 * Each entry maps a panel-id prefix to a React icon component. The
 * `<LineTab>` resolver picks the contribution whose `panelIdPrefix`
 * the rendered panel id starts with (longest prefix wins) and renders
 * `<Icon className="h-3.5 w-3.5" />` next to the title.
 *
 * Lives on the renderer side (`dock-react`) rather than `dock`
 * because the value is a React component — the logic-side `dock`
 * fragment must stay React-free per ADR 0002.
 */
export interface DockTabIcon {
  /** Panel-id prefix (with trailing colon, e.g. `"pdf-viewer:"`). */
  panelIdPrefix: string;
  /** Icon to render. Must accept a `className` prop. */
  Icon: ComponentType<{ className?: string }>;
}

export const dockTabIconSlot = defineSlot<DockTabIcon>("dock:tab-icons");
