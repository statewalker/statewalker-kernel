import type { UrlState, UrlStateView } from "@statewalker/platform.core";
import { newRegistry } from "@statewalker/shared-registry";

/** Escapes `encodeURIComponent` applies that a hash's path may carry as they are. */
const KEPT = /%(21|24|26|27|28|29|2A|2B|2C|3A|3B|3D|40)/gi;

/**
 * A path as the hash carries it: each `/`-separated segment percent-encoded, so `?`, `#`, `%`,
 * spaces and non-ASCII characters survive, while plain paths (`/docs/a.md:12`) keep their spelling.
 */
function encodePath(path: string): string {
  return path
    .split("/")
    .map((segment) =>
      encodeURIComponent(segment).replace(KEPT, (escape) => decodeURIComponent(escape)),
    )
    .join("/");
}

/** A hash's path, decoded segment by segment; a segment that is not valid encoding stays as is. */
function decodePath(path: string): string {
  return path
    .split("/")
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

/**
 * Parse a URL hash string into a `UrlState`.
 * Format: `#/path?key=val&key2=val2`, the path's segments percent-decoded.
 */
export function parseHash(hash: string): UrlState {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const qIndex = raw.indexOf("?");
  const path = decodePath(qIndex >= 0 ? raw.slice(0, qIndex) : raw);
  const query: Record<string, string> = {};
  if (qIndex >= 0) {
    const params = new URLSearchParams(raw.slice(qIndex + 1));
    for (const [k, v] of params) {
      query[k] = v;
    }
  }
  return { path, query };
}

/**
 * Serialize a `UrlState` into a hash string.
 * Format: `#/path?key=val&key2=val2`, the path's segments percent-encoded (`parseHash` reverses it).
 */
export function buildHash(state: UrlState): string {
  const params = new URLSearchParams(state.query);
  const qs = params.toString();
  const path = encodePath(state.path);
  return qs ? `#${path}?${qs}` : `#${path}`;
}

/**
 * Bind a `UrlStateView` to `location.hash` and the `hashchange` event.
 *
 * - Model → URL: when the view notifies (via `sync()`), the serialized
 *   state is written to `location.hash`.
 * - URL → Model: external hash changes (browser back/forward, manual
 *   edit) are parsed and fed to `model.applyUrl()`.
 *
 * Initialises the model from the current hash on bind. Returns a
 * cleanup that removes the listener.
 */
export function bindUrlState(model: UrlStateView): () => void {
  const [register, cleanup] = newRegistry();

  register(
    model.onUpdate(() => {
      const hash = buildHash(model.buildState());
      if (location.hash !== hash) {
        location.hash = hash;
      }
    }),
  );

  function onHashChange(): void {
    model.applyUrl(parseHash(location.hash));
  }
  window.addEventListener("hashchange", onHashChange);
  register(() => window.removeEventListener("hashchange", onHashChange));

  if (location.hash) {
    model.applyUrl(parseHash(location.hash));
  }

  return cleanup;
}
