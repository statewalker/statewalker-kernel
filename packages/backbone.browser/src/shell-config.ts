import type { AppManifest } from "@statewalker/backbone.core";

/**
 * @deprecated Use `AppManifest` from `@repo/backbone-common`.
 */
export type ShellConfig = AppManifest;

/**
 * Load the application manifest from, in priority order:
 * 1. URL parameters (`?root=`, `?module=name:url`, `?config=<url>`)
 * 2. Fetched JSON (from `?config=<url>`)
 * 3. Embedded config (`<script type="application/json" id="app-manifest">`)
 *    Legacy id `shell-config` is also accepted.
 * 4. Provided defaults
 */
export async function loadAppManifest(defaults?: Partial<AppManifest>): Promise<AppManifest> {
  let manifest: AppManifest = {
    roots: defaults?.roots ?? [],
    ...(defaults?.modules ? { modules: { ...defaults.modules } } : {}),
  };

  const embeddedEl =
    document.getElementById("app-manifest") ?? document.getElementById("shell-config");
  if (embeddedEl?.textContent) {
    try {
      const embedded = JSON.parse(embeddedEl.textContent) as Partial<AppManifest>;
      manifest = mergeManifest(manifest, embedded);
    } catch {
      console.warn("[backbone-web] Failed to parse embedded app-manifest");
    }
  }

  const params = new URLSearchParams(location.search);
  const configUrl = params.get("config");
  if (configUrl) {
    try {
      const res = await fetch(configUrl);
      if (res.ok) {
        const fetched = (await res.json()) as Partial<AppManifest>;
        manifest = mergeManifest(manifest, fetched);
      }
    } catch {
      console.warn(`[backbone-web] Failed to fetch config from ${configUrl}`);
    }
  }

  const rootParams = params.getAll("root");
  if (rootParams.length > 0) {
    manifest.roots = rootParams;
  }

  for (const moduleParam of params.getAll("module")) {
    const colonIdx = moduleParam.indexOf(":");
    if (colonIdx > 0) {
      const name = moduleParam.slice(0, colonIdx).trim();
      const url = moduleParam.slice(colonIdx + 1).trim();
      manifest.modules = { ...manifest.modules, [name]: url };
    }
  }

  return manifest;
}

/**
 * @deprecated Use `loadAppManifest`.
 */
export const loadShellConfig = loadAppManifest;

function mergeManifest(base: AppManifest, override: Partial<AppManifest>): AppManifest {
  const modules =
    base.modules || override.modules ? { ...base.modules, ...override.modules } : undefined;
  return {
    roots: override.roots ?? base.roots,
    ...(modules ? { modules } : {}),
  };
}
