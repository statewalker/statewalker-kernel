import type { ResolvedModule } from "@statewalker/backbone.core";

export interface ImportMap {
  imports: Record<string, string>;
}

interface PackageJson {
  exports?: Record<string, string>;
}

/**
 * Builds an import map from resolved modules by reading each module's
 * package.json exports field and generating specifier → URL entries.
 *
 * For modules without an exports field, maps the bare name to <baseUrl>/index.js.
 */
export function buildImportMap(
  modules: ResolvedModule[],
  registry: Map<string, string>,
): ImportMap {
  const imports: Record<string, string> = {};

  for (const mod of modules) {
    const baseUrl = registry.get(mod.name) ?? mod.url;
    const pkg = (mod as { packageJson?: PackageJson }).packageJson;
    const exports = pkg?.exports;

    if (exports && typeof exports === "object") {
      for (const [subpath, target] of Object.entries(exports)) {
        if (typeof target !== "string") continue;
        const specifier = subpath === "." ? mod.name : `${mod.name}/${subpath.slice(2)}`;
        const resolvedUrl = new URL(target, ensureTrailingSlash(baseUrl)).href;
        imports[specifier] = resolvedUrl;
      }
    } else {
      // No exports — map bare name directly
      // If the registry URL looks like a direct module URL (has extension), use it as-is
      if (looksLikeModuleUrl(baseUrl)) {
        imports[mod.name] = baseUrl;
      } else {
        imports[mod.name] = new URL("index.js", ensureTrailingSlash(baseUrl)).href;
      }
    }
  }

  return { imports };
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function looksLikeModuleUrl(url: string): boolean {
  const path = new URL(url, "file:///").pathname;
  return /\.\w+$/.test(path);
}
