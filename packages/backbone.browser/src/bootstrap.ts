import { type AppManifest, activateModules, type ResolvedModule } from "@statewalker/backbone.core";
import { buildImportMap } from "./build-import-map.js";
import { createBrowserResolver } from "./create-browser-resolver.js";
import { sourceHook } from "./source-hooks.js";

// es-module-shims global API (declared, not imported — loaded via <script>)
declare const importShim: {
  (specifier: string): Promise<Record<string, unknown>>;
  addImportMap(map: { imports: Record<string, string> }): void;
  getImportMap(): { imports: Record<string, string> };
};

/**
 * Browser-side bootstrap. Dispatches on manifest shape:
 * - `modules` absent or empty → bundler mode: roots are loaded via native
 *   dynamic `import()`, resolved by the bundler's existing module graph.
 * - `modules` populated → dynamic mode: uses `es-module-shims` + an
 *   HTTP-built import map to resolve roots from fetchable base URLs.
 */
export async function bootstrap(
  manifest: AppManifest,
  ctx: Record<string, unknown> = {},
): Promise<() => Promise<void>> {
  const hasModules = manifest.modules && Object.keys(manifest.modules).length > 0;

  return hasModules ? bootstrapDynamic(manifest, ctx) : bootstrapBundler(manifest, ctx);
}

async function bootstrapBundler(
  manifest: AppManifest,
  ctx: Record<string, unknown>,
): Promise<() => Promise<void>> {
  return activateModules(
    manifest.roots,
    (spec) => import(/* @vite-ignore */ resolveBundlerSpecifier(spec)),
    ctx,
  );
}

/**
 * Turn a bare specifier into a URL the browser can fetch at runtime.
 *
 * Absolute URLs and absolute paths pass through unchanged. Bare package
 * specifiers are rewritten to Vite's `/@id/<spec>` endpoint — Vite dev-server
 * resolves and transforms the module on demand. For production builds that
 * run outside Vite, declare an `<script type="importmap">` in the host HTML
 * (or switch to dynamic mode with `manifest.modules`) so the browser can
 * resolve bare specifiers natively.
 */
function resolveBundlerSpecifier(spec: string): string {
  if (/^(https?:)?\/\//.test(spec) || spec.startsWith("/")) return spec;
  return `${location.origin}/@id/${spec}`;
}

async function bootstrapDynamic(
  manifest: AppManifest,
  ctx: Record<string, unknown>,
): Promise<() => Promise<void>> {
  const modules = manifest.modules ?? {};
  const registry = new Map(Object.entries(modules));

  const resolver = createBrowserResolver(registry);
  const ordered = await resolver.resolveModules("", manifest.roots);

  const resolvedWithPkg = ordered as Array<
    ResolvedModule & { packageJson?: Record<string, unknown> }
  >;

  const importMap = buildImportMap(resolvedWithPkg, registry);

  for (const [name, url] of registry) {
    if (!importMap.imports[name] && !ordered.some((m) => m.name === name)) {
      importMap.imports[name] = url;
    }
  }

  importShim.addImportMap(importMap);
  console.log(`[backbone-web] Import map: ${Object.keys(importMap.imports).length} entries`);

  return activateModules(
    ordered,
    async (mod) => {
      return (await importShim(mod.name)) as Record<string, unknown>;
    },
    ctx,
  );
}

/**
 * Configure es-module-shims options. Must be called BEFORE es-module-shims loads.
 * Typically set via <script type="esms-options"> in HTML, but this helper
 * can be used to set options programmatically.
 */
export function configureEsModuleShims(options?: { hotReload?: boolean }): void {
  (window as unknown as Record<string, unknown>).esmsInitOptions = {
    shimMode: true,
    mapOverrides: true,
    hotReload: options?.hotReload ?? false,
    source: sourceHook,
  };
}
