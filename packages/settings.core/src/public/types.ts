/**
 * Slot value contributed to `settings:tabs`. Slot pattern C — the
 * tab content is identified by `viewKey`, looked up at render time
 * via `ViewRegistry.get(viewKey)`. Logic fragments contribute
 * tabs without importing React; their paired renderer fragments
 * register the actual React component into `ViewRegistry`.
 */
export interface SettingsTab {
  /** Stable identifier (e.g. `"providers"`, `"keyboard"`). Becomes
   * the URL hash anchor / activeTabId. */
  id: string;
  /** Sidebar label. */
  title: string;
  /** ViewRegistry key resolved by settings-views at render time. */
  viewKey: string;
  /** Sort order; lower numbers appear first. Default: 100. */
  order?: number;
}
