/**
 * Application manifest — the single declaration schema used by every
 * bootstrap entry (browser HTML and Node CLI).
 *
 * `modules` is the optional resolver override:
 * - absent or empty → resolve through platform defaults (filesystem on Node,
 *   bundler on browser)
 * - populated → browser bootstrap selects the import-map dynamic path, using
 *   the entries as `name → base URL` for HTTP module fetch
 */
export interface AppManifest {
  roots: string[];
  modules?: Record<string, string>;
}

/**
 * A fragment is a module whose default export is an init function.
 * `init(ctx)` may return a teardown callback; async teardowns are supported.
 */
export type FragmentInit = (
  ctx: Record<string, unknown>,
) => (() => void | Promise<void>) | undefined | Promise<(() => void | Promise<void>) | undefined>;
