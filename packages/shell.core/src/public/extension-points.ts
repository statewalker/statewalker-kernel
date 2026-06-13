import { defineSlot } from "@statewalker/shared-slots";

/**
 * Slot value for `dock:side-panels`. Each contribution renders one
 * `<ResizablePanel/>` inside `<MainShell/>`'s `<ResizablePanelGroup/>`
 * on the configured `side`, with the React component looked up via
 * `ViewRegistry.get(viewKey)`. `defaultSize` / `minSize` / `maxSize`
 * accept the same units as `react-resizable-panels` (`"40%"`, `"180px"`,
 * `"10rem"`, raw numbers as percent). Lower `order` values render
 * closer to the screen edge.
 */
export interface DockSidePanel {
  id: string;
  side: "left" | "right";
  order?: number;
  viewKey: string;
  defaultSize?: number | string;
  minSize?: number | string;
  maxSize?: number | string;
}

/**
 * Slot value for `dock:header-items`. Each contribution renders one
 * cell inside `<ShellHeader/>`, grouped by `slot` and ordered by
 * `order`. The component is looked up via `ViewRegistry.get(viewKey)`.
 */
export interface DockHeaderItem {
  id: string;
  slot: "leading" | "trailing";
  order?: number;
  viewKey: string;
}

/**
 * Slot value for `dock:overlays`. Each contribution mounts one
 * non-layout React component (modals, dialogs, toasters) alongside
 * `<MainShell/>`. Order is irrelevant; components manage their own
 * open/close visibility.
 */
export interface DockOverlay {
  id: string;
  viewKey: string;
}

export const dockSidePanelsSlot = defineSlot<DockSidePanel>("dock:side-panels");
export const dockHeaderItemsSlot = defineSlot<DockHeaderItem>("dock:header-items");
export const dockOverlaysSlot = defineSlot<DockOverlay>("dock:overlays");
