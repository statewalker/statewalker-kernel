# @statewalker/backbone.browser

## What it is

The browser bootstrap for backbone applications. `bootstrap(manifest, ctx)` loads the manifest's root modules and runs their fragment `init(ctx)` functions in dependency order. `loadAppManifest()` builds the manifest from the page and its URL.

## Why it exists

A backbone application is described by an `AppManifest` (`@statewalker/backbone.core`). In a browser the same manifest has to work in two situations: inside a bundled app (Vite), where modules are already part of the build, and on a page that assembles an application at runtime from modules served over HTTP. This package covers both, so an application's start-up code is the same in either case.

## How to use

```sh
pnpm add @statewalker/backbone.browser
```

Browser only. `bootstrap` picks a mode from the manifest:

```
manifest.modules empty or absent          manifest.modules = { name: baseUrl }
            |                                           |
      bundler mode                                dynamic mode
  import(spec) for each root          fetch <baseUrl>/package.json per module,
  (bare spec -> /@id/<spec>)          follow workspace: deps, install import map,
            |                          importShim(name) for each module
            +--------------> activateModules(...) <-----+
```

Dynamic mode needs [es-module-shims](https://github.com/guybedford/es-module-shims) on the page in shim mode. It is not a dependency of this package; load it with a `<script>` tag.

## Examples

Bundled app:

```ts
import { bootstrap, loadAppManifest } from "@statewalker/backbone.browser";

const manifest = await loadAppManifest({ roots: ["@my/app-fragment"] });
const ctx: Record<string, unknown> = {};
const stop = await bootstrap(manifest, ctx);

window.addEventListener("pagehide", () => void stop());
```

Runtime-assembled page. Configure es-module-shims, load it, then bootstrap with `modules`:

```ts
import { bootstrap, configureEsModuleShims } from "@statewalker/backbone.browser";

configureEsModuleShims({ hotReload: false });
await new Promise((resolve, reject) => {
  const script = document.createElement("script");
  script.src = "https://cdn.jsdelivr.net/npm/es-module-shims@2/dist/es-module-shims.js";
  script.onload = resolve;
  script.onerror = reject;
  document.head.append(script);
});

await bootstrap({
  roots: ["@my/app-fragment"],
  modules: {
    "@my/app-fragment": "https://cdn.example.com/app-fragment/",
    "@my/shared": "https://cdn.example.com/shared/",
  },
});
```

Manifest from the URL: `index.html?root=@my/app-fragment&module=@my/app-fragment:https://cdn.example.com/app-fragment/`.

Lower-level pieces, for custom loaders:

```ts
import { buildImportMap, createBrowserResolver, sourceHook } from "@statewalker/backbone.browser";

const registry = new Map([["@my/app-fragment", "https://cdn.example.com/app-fragment/"]]);
const ordered = await createBrowserResolver(registry).resolveModules("", ["@my/app-fragment"]);
const importMap = buildImportMap(ordered, registry); // { imports: { "@my/app-fragment": ".../index.js" } }
```

`sourceHook` is the es-module-shims `source` hook that `configureEsModuleShims` installs.

## Internals

### Where the manifest comes from

`loadAppManifest(defaults?)` applies, later entries winning: `defaults`; JSON in `<script type="application/json" id="app-manifest">` (id `shell-config` is also accepted); JSON fetched from `?config=<url>`; `?root=<spec>` parameters, which replace `roots`; `?module=<name>:<url>` parameters, which add to `modules`. A broken embedded JSON or a failed fetch logs `[backbone-web] Failed to parse embedded app-manifest` or `[backbone-web] Failed to fetch config from <url>` and is skipped. `loadShellConfig` and the `ShellConfig` type are aliases kept for older callers.

### Bundler mode relies on Vite's dev server for bare specifiers

Absolute URLs and paths are imported as given. Bare specifiers are rewritten to `${location.origin}/@id/<spec>`, an endpoint only the Vite dev server answers. In a production build outside Vite, declare a `<script type="importmap">` for the roots or use dynamic mode; otherwise the import fails with a 404 for `/@id/...`.

### Dynamic mode compiles TypeScript in the browser

`configureEsModuleShims({ hotReload? })` sets `window.esmsInitOptions` to `{ shimMode: true, mapOverrides: true, hotReload, source: sourceHook }`. It must run before es-module-shims loads, or the options are ignored. `sourceHook` turns `.css` into a module that appends a `<style>` and exports the CSS text, compiles `.ts`/`.tsx` with sucrase (type stripping plus the automatic JSX runtime), and turns `.json` into `export default <json>`. Other URLs go to the default loader.

### Each module maps to `<baseUrl>/index.js`

The resolver fetches `<baseUrl>/package.json` for every module and follows its `workspace:` dependencies. `buildImportMap` can map each `exports` subpath, but only when a module carries its parsed `packageJson`, and `createBrowserResolver` does not attach it. In practice every module maps to `<baseUrl>/index.js` (or to the base URL itself when it ends in a file extension), and subpath imports such as `@my/pkg/fragment` do not resolve. Registry entries that were not resolved are added to the import map as given. A name missing from the registry fails with `Module "<name>" not found in registry`; a missing `package.json` makes that module a leaf.

### Dependencies

- `@statewalker/backbone.core`: manifest type, resolver, activation loop.
- `sucrase`: in-browser TypeScript and JSX compilation for dynamic mode.

## License

MIT
