import type { SpecStore } from "./spec-store.js";
import type { Spec } from "./types.js";

export interface RestorePanelSpecsFromLayoutOptions {
  /** Target SpecStore. New entries are inserted; existing ids are skipped. */
  store: SpecStore;
  /**
   * The persisted DockView layout object, as held by the `LayoutStore` adapter
   * (`workspace.requireAdapter(LayoutStore).get()`). `null`/`undefined` is a no-op.
   */
  layout: object | null | undefined;
  /**
   * Panel-id prefix (with trailing colon) the panel kind owns —
   * e.g. `"pdf-viewer:"` matches `"pdf-viewer:/docs/x.pdf"`.
   * Only panel ids that start with this prefix AND have a non-empty
   * suffix after it are restored.
   */
  panelIdPrefix: string;
  /** Catalog id that pairs with this panel kind. */
  catalogId: string;
  /** Build the spec from the suffix (everything after `panelIdPrefix`). */
  buildSpec: (suffix: string) => Spec;
  /** Build the spec id from the suffix. Must mirror what producers use. */
  buildSpecId: (suffix: string) => string;
  /** Spec metadata. Defaults to `{ persistent: true }` so the dock fragment doesn't evict. */
  meta?: Record<string, unknown>;
}

/**
 * Walk a DockView layout object (from the `LayoutStore` adapter) and
 * pre-allocate one spec per panel id that starts with `panelIdPrefix`.
 * Designed to run in each fragment's `workspace.onLoad` handler, BEFORE
 * `DockHost` applies the layout via `fromJSON()` — that's the only window
 * where the spec must already be in the store, since `JsonPanel` looks it up
 * synchronously when the restored panel renders. Without this pass, every
 * restored tab flashes the `PanelMissing` placeholder until something else
 * recreates the spec.
 *
 * Idempotent: existing spec ids are skipped, so repeat calls (hot reload,
 * double-mount in StrictMode, re-connect) are safe.
 *
 * Defensive against shape changes in DockView's serialization — only walks
 * `layout.panels`'s keys; everything else is ignored. A missing layout or a
 * non-object `panels` field is a no-op rather than an error.
 */
export function restorePanelSpecsFromLayout(opts: RestorePanelSpecsFromLayoutOptions): void {
  const { store, layout, panelIdPrefix } = opts;
  if (!layout || typeof layout !== "object") return;
  const panels = (layout as { panels?: unknown }).panels;
  if (!panels || typeof panels !== "object") return;

  const meta = opts.meta ?? { persistent: true };
  for (const panelId of Object.keys(panels)) {
    if (!panelId.startsWith(panelIdPrefix) || panelId.length <= panelIdPrefix.length) {
      continue;
    }
    const suffix = panelId.slice(panelIdPrefix.length);
    const specId = opts.buildSpecId(suffix);
    if (store.get(specId)) continue;
    store.create({
      id: specId,
      catalogId: opts.catalogId,
      spec: opts.buildSpec(suffix),
      meta,
    });
  }
}
