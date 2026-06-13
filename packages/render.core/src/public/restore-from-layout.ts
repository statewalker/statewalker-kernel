import type { SpecStore } from "./spec-store.js";
import type { Spec } from "./types.js";

export interface RestorePanelSpecsFromLayoutOptions {
  /** Target SpecStore. New entries are inserted; existing ids are skipped. */
  store: SpecStore;
  /** Source of the persisted DockView layout JSON. Typically `globalThis.localStorage`. */
  storage: Storage | undefined;
  /** Storage key the DockHost serializes its layout under. */
  layoutKey: string;
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
 * Walk a persisted DockView layout JSON in `storage[layoutKey]` and
 * pre-allocate one spec per panel id that starts with
 * `panelIdPrefix`. Designed to run at fragment-init time, BEFORE the
 * React tree mounts and `DockHost.setApi` calls `fromJSON()` — that's
 * the only window where the spec must already be in the store, since
 * `JsonPanel` looks it up synchronously when the restored panel
 * renders. Without this pass, every restored tab flashes the
 * `PanelMissing` placeholder until something else recreates the spec.
 *
 * Idempotent: existing spec ids are skipped, so repeat calls (hot
 * reload, double-mount in StrictMode) are safe.
 *
 * Defensive against shape changes in DockView's serialization — only
 * walks `parsed.panels`'s keys; everything else is ignored. Non-JSON
 * payloads, missing storage, and missing keys are no-ops rather than
 * errors.
 */
export function restorePanelSpecsFromLayout(opts: RestorePanelSpecsFromLayoutOptions): void {
  const { store, storage, layoutKey, panelIdPrefix } = opts;
  if (!storage) return;
  const raw = storage.getItem(layoutKey);
  if (!raw) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object") return;
  const panels = (parsed as { panels?: unknown }).panels;
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

/**
 * Stable storage key used by `DockHost.serialize` / `restore`. Exposed
 * here so callers don't have to hardcode it. Matches the one in
 * `@statewalker/dock`'s internal `dock-host.ts`; will migrate to
 * `SystemFiles/dock-layout.json` alongside the dock fragment's
 * persistence migration in Wave 3.
 */
export const DOCK_LAYOUT_STORAGE_KEY = "chat-mini:dock-layout";
