import type { Spec } from "@json-render/core";

/**
 * Pure spec data + id helpers for the file-explorer panel. Per ADR 0002
 * (logic / renderer split), this React-free logic fragment owns only the
 * deterministic ids and the opaque `Spec` builder; the schema-typed
 * `fileExplorerCatalog` (which needs `@json-render/react`'s `schema`) and
 * the `FileExplorerView` React binding live in the paired
 * `file-explorer-react` renderer fragment.
 *
 * The single element (`FileExplorerView`) is parameterised by `panelId`
 * so each dock tab gets its own controller, label, and starting path.
 */
export const FILE_EXPLORER_CATALOG_ID = "file-explorer";

export interface FileExplorerSpecOptions {
  label?: string;
  initialPath?: string;
  mainViewerHost?: boolean;
  folderNavigationHost?: boolean;
}

export function makeFileExplorerSpec(panelId: string, options: FileExplorerSpecOptions = {}): Spec {
  return {
    root: "panel",
    elements: {
      panel: {
        type: "FileExplorerView",
        props: { panelId, ...options },
        children: [],
      },
    },
  } as Spec;
}

/** Deterministic dock panel id so reopening the same explorer tab focuses it. */
export function fileExplorerPanelId(id: string): string {
  return `file-explorer:${id}`;
}

/** Deterministic spec id; pairs with `fileExplorerPanelId`. */
export function fileExplorerSpecId(id: string): string {
  return `spec:file-explorer:${id}`;
}
