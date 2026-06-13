/**
 * Plan returned by a `MimeRenderer.buildPanel`. The viewer fragment
 * owns its catalog id, spec shape, and deterministic ids — so opening
 * the same URI twice focuses the existing panel rather than creating a
 * duplicate. The visualize handler feeds this directly into
 * `SpecStore.create` + `runShowDockPanel`.
 */
export interface MimePanelPlan {
  catalogId: string;
  /** json-render spec referencing `catalogId`. Held opaquely. */
  spec: unknown;
  panelId: string;
  specId: string;
  /** Optional dock tab title; defaults to the URI when omitted. */
  title?: string;
}

/**
 * Slot value contributed to `files:mime-renderers`. The `files:visualize`
 * handler resolves a contribution by `mimeTypePattern` (a glob with `*`
 * as wildcard) and calls `buildPanel(uri)` to obtain the spec + ids,
 * then creates the spec in `SpecStore` and opens the panel via
 * `runShowDockPanel`. Slot pattern C.
 */
export interface MimeRenderer {
  /**
   * Glob-style pattern matched against the resolved MIME type.
   * Examples: `"text/markdown"`, `"image/*"`, `"application/json"`.
   */
  mimeTypePattern: string;
  /** Sort order; lower numbers win when multiple match. Default: 100. */
  order?: number;
  /**
   * Returns the panel/spec inputs for the given URI. The viewer
   * fragment is the only place that knows its catalog id and spec
   * shape — this keeps `files/` agnostic of any concrete viewer.
   */
  buildPanel(uri: string): MimePanelPlan;
}

/**
 * Slot value contributed to `files:mime-icons`. Resolved by the
 * file explorer / breadcrumbs UI to render an icon for a file.
 */
export interface MimeIcon {
  mimeTypePattern: string;
  /** Lucide icon name or arbitrary registry key (consumer-defined). */
  icon: string;
  order?: number;
}

/**
 * Slot value contributed to `files:editor-factories`. Wave 5.1
 * declares the slot for forward-compatibility; the full editor
 * substrate lands in a follow-up wave.
 */
export interface EditorFactory {
  mimeTypePattern: string;
  /** ViewRegistry key for the editing surface. */
  viewKey: string;
  order?: number;
}

/**
 * Slot value contributed to `files:indexers`. Background indexers
 * (full-text, embeddings, etc.) plug into this slot. Wave 5.1
 * declares only — the runner that orchestrates indexers lands
 * with the search wave.
 */
export interface Indexer {
  /** Stable id used for diff'ing across runs. */
  id: string;
  /** Indexer entry point. The bus passes the workspace's
   * primary `FilesApi` so the indexer can scan / read files. */
  run(opts: { signal?: AbortSignal }): Promise<void>;
}
