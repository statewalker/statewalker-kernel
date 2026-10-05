# @statewalker/backbone.core

## What it is

The shared core of the backbone bootstraps. It defines the `AppManifest` (which modules an application starts), resolves those modules into a dependency-ordered list, and runs each module's `init(ctx)` function. `@statewalker/backbone.node` and `@statewalker/backbone.browser` are thin I/O layers over it.

## Why it exists

A backbone application is a list of *fragments*: modules whose default export is `init(ctx)`, optionally returning a teardown. The same manifest has to start the same fragments in a browser page and in a Node process. This package holds the parts that do not depend on the host: the manifest schema, dependency ordering, and the activation loop with its error and teardown rules. Each host only supplies "how do I find a module" and "how do I load it".

## How to use

```sh
pnpm add @statewalker/backbone.core
```

Most applications use it through `@statewalker/backbone.node` or `@statewalker/backbone.browser`. Use it directly when you need a custom host:

1. Create a `ModuleResolver` with three callbacks: `resolve(baseUrl, moduleId)`, `findPackageJson(moduleUrl)`, `loadPackageJson(url)`.
2. Call `resolver.resolveModules(baseUrl, roots)` to get `ResolvedModule[]` (`{ name, url, version, packageJsonUrl }`), dependencies first.
3. Call `activateModules(ordered, loadModule, ctx)` and keep the returned cleanup.

## Examples

Resolve and activate:

```ts
import { activateModules, type AppManifest, ModuleResolver } from "@statewalker/backbone.core";

const manifest: AppManifest = { roots: ["@my/app-fragment"] };

const resolver = new ModuleResolver({
  resolve: async (_baseUrl, moduleId) => `https://example.com/modules/${moduleId}/`,
  findPackageJson: async (moduleUrl) => new URL("package.json", moduleUrl).href,
  loadPackageJson: async (url) => (await fetch(url)).json(),
});
const ordered = await resolver.resolveModules("", manifest.roots);

const ctx: Record<string, unknown> = {};
const stop = await activateModules(ordered, (mod) => import(mod.url), ctx, (mod, error) =>
  console.error(`init failed: ${mod.name}`, error),
);

await stop(); // teardowns run in reverse order
```

A fragment:

```ts
import type { FragmentInit } from "@statewalker/backbone.core";

const init: FragmentInit = (ctx) => {
  const timer = setInterval(() => {}, 1000);
  return () => clearInterval(timer);
};
export default init;
```

Topological sort of your own graph:

```ts
import { topoSort } from "@statewalker/backbone.core";

const graph = new Map([
  ["app", { name: "app", deps: ["db", "log"] }],
  ["db", { name: "db", deps: ["log"] }],
  ["log", { name: "log", deps: [] }],
]);
topoSort(graph).map((n) => n.name); // ["log", "db", "app"]
```

Logging:

```ts
import { getLogger, setLogger } from "@statewalker/backbone.core";

setLogger(ctx, myLogger); // any object with level, fatal..trace and child()
getLogger(ctx).info("started");
```

`formatModulesMap(map)` groups a `name -> URL` map by common URL prefix; the bootstraps use it for their start-up log line.

## Internals

### One failing fragment does not stop the others

`activateModules` catches load errors and `init` errors per module, passes them to `onError`, and moves on. The default `onError` prints `[backbone] Module activation failed for <entry>: <error>`. A fragment whose module has no function default export is skipped without a message. Teardowns run in reverse activation order; a teardown that throws is also routed to `onError`.

### Only `workspace:` dependencies are followed

`resolveModules` reads each module's `package.json` and follows only dependencies whose range starts with `workspace:`. Everything else is treated as an ordinary library, not a fragment. Consequence: fragments are discovered transitively only from source `package.json` files inside a pnpm workspace. Packages installed from npm have real version ranges, so their fragment dependencies are not followed; list every fragment you need in `roots`.

### Two orderings, for two jobs

`resolveModules` does a depth-first walk from the roots in the order given: each dependency lands just before the module that needs it, and independent roots keep the caller's order. `topoSort` is Kahn's algorithm with alphabetical tie-breaking (or your comparator), for callers that already have a graph. Both throw on cycles: `Circular dependency detected: <name>` and `Circular dependency detected among: a -> b`.

A `package.json` that cannot be loaded makes that module a leaf with an empty version rather than an error.

### No runtime dependencies

The package has no dependencies. The backbone packages may depend at runtime only on each other, so the `Logger` type and the `getLogger`/`setLogger` lookup are vendored in `src/_vendor/` instead of imported from `@statewalker/shared-logger`. `scripts/check-backbone-isolation.ts` at the repository root checks the rule (`pnpm exec tsx scripts/check-backbone-isolation.ts`); it is not part of CI.

`getLogger(ctx)` stores its logger under `ctx["app.logger"]`. When none is set it creates a console logger at `process.env.LOG_LEVEL` (default `info`). In a browser without a `process` global this throws `ReferenceError: process is not defined`, so call `setLogger` first there.

## License

MIT
