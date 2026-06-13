/**
 * Public types re-exported by `@statewalker/file-explorer`.
 *
 * Models live in their own files (`files-list.model.ts`,
 * `files-tree.model.ts`, `search.model.ts`, `view-model.ts`,
 * `file-display.ts`); this file is reserved for cross-cutting
 * structural types only.
 */

export interface FileExplorerSide {
  /** Stable id used for the dock panel id and the layout preset. */
  id: string;
  /** Initial directory to show; defaults to `/`. */
  initialPath?: string;
  /** Tab/panel label. */
  label?: string;
}
