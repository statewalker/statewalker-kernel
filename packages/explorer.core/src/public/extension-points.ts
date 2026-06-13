import { defineKeyedSlot, defineSlot } from "@statewalker/shared-slots";

/**
 * `file-explorer:panels` — declarative two-pane preset contributions.
 *
 * Each contribution lights up one file-explorer panel inside the dock
 * (or a dock side panel) when the workspace boots. `explorer.app`
 * contributes two of these on first boot to recreate the
 * commander-style two-pane layout (the "two-pane preset" requirement
 * in the `file-management-split` capability spec).
 */
export interface FileExplorerPanelPreset {
  /** Stable id (e.g. "explorer:left", "explorer:right"). */
  id: string;
  /** Display label for the panel/tab. */
  label: string;
  /**
   * Initial path to load. The renderer constructs a `PanelController`
   * with the workspace's current `FilesApi` and navigates to this path.
   */
  initialPath?: string;
  /**
   * Where this panel should live. When omitted, the renderer chooses
   * based on the contribution's `order` (lowest goes left).
   */
  side?: "left" | "right" | "main";
  /** Lower wins; defaults to 100. */
  order?: number;
  /**
   * Mark this panel as the host for **file** activations: clicking a
   * file in any panel routes the resulting viewer tab into THIS
   * panel's group (via `runVisualizeFile`'s `referencePanelId`). The
   * canonical layout flags the main panel.
   */
  mainViewerHost?: boolean;
  /**
   * Mark this panel as the host for **folder** activations: clicking
   * a folder in any panel re-targets navigation to THIS panel and
   * focuses it. The canonical layout flags the left panel so the
   * main panel can stay locked on the user's working directory.
   */
  folderNavigationHost?: boolean;
}

export const fileExplorerPanelPresetsSlot =
  defineSlot<FileExplorerPanelPreset>("file-explorer:panels");

/**
 * Runtime handle exposed by an active file-explorer panel. Mounted
 * panels register one of these under their `panelId` so the
 * `files:open` command handler can route directory navigations to the
 * right panel without coupling the command layer to React.
 */
export interface ActiveFileExplorerPanel {
  /** Navigate this panel to `path`, loading it through the panel's `FilesApi`. */
  navigate(path: string): void;
  /** Whether file activations should route here (see preset's `mainViewerHost`). */
  isMainViewerHost: boolean;
  /** Whether folder activations should route here (see preset's `folderNavigationHost`). */
  isFolderNavigationHost: boolean;
}

export const activeFileExplorerPanelsSlot = defineKeyedSlot<ActiveFileExplorerPanel>(
  "file-explorer:active-panels",
);
