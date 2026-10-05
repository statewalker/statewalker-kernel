# @statewalker/backbone.node

## What it is

The Node bootstrap for backbone applications. `bootstrap(manifest, ctx)` resolves the manifest's root modules with Node module resolution, imports them in dependency order and runs their fragment `init(ctx)` functions. Two CLI scripts, `backbone-start` and `backbone-watch`, start a long-running process from a list of root modules.

## Why it exists

The same `AppManifest` (`@statewalker/backbone.core`) that starts an application in a browser should start its server-side fragments in Node. This package supplies the Node half: resolving specifiers against `node_modules` the way `import` does, reading `package.json` files from disk, and keeping the process alive until a signal arrives.

## How to use

```sh
pnpm add @statewalker/backbone.node
```

Node only. Modules are resolved relative to `process.cwd()`, so run from the directory whose `node_modules` holds the fragments.

## Examples

From code:

```ts
import { bootstrap } from "@statewalker/backbone.node";

const ctx: Record<string, unknown> = {};
const stop = await bootstrap({ roots: ["@my/server-fragment"] }, ctx);

process.on("SIGTERM", async () => {
  await stop();
  process.exit(0);
});
```

From the command line (needs `tsx` installed in the project, see below):

```sh
pnpm exec backbone-start @my/server-fragment @my/other-fragment
ENV_FILE=.env pnpm exec backbone-watch @my/server-fragment
```

The scripts print `[backbone] Loading modules: ...` (or `No modules specified — running bare backbone`), activate the roots, and run the teardowns on SIGINT or SIGTERM before exiting.

## Internals

### The CLI runs TypeScript through tsx

`bin/start.sh` runs `node --import tsx/esm src/main.ts <roots...>`; `bin/watch.sh` adds `--watch`. Both add `--env-file=$ENV_FILE` when `ENV_FILE` names an existing file. `tsx` is a development dependency of this package, not a runtime one, so a project that uses the scripts must install `tsx` itself. Without it Node fails with `Cannot find package 'tsx'`.

### Resolution follows Node, with one fallback

Each root is resolved with `import-meta-resolve` from `<cwd>/package.json`, exactly as an `import` statement there would. A package whose `exports` has no root entry fails standard resolution with `ERR_PACKAGE_PATH_NOT_EXPORTED`; for those the resolver walks up the `node_modules` directories to find the package folder instead. Transitive fragments are found only through `workspace:` dependencies (see `@statewalker/backbone.core`), so in an installed (non-workspace) setup list every fragment in `roots`. `manifest.modules` is ignored on Node.

### Failures that are easy to miss

- A root whose `import()` fails is skipped without any message. If a fragment seems not to run, check that the specifier imports on its own.
- An `init` that throws is printed as `[backbone] Module activation failed for <module>: <error>`, and the remaining fragments still start.
- Logging goes through `getLogger(ctx)`: set `LOG_LEVEL`, or put your own logger in `ctx` with `setLogger` from `@statewalker/backbone.core`.

### Dependencies

- `@statewalker/backbone.core`: resolver and activation loop.
- `import-meta-resolve`: Node's ESM resolution algorithm as a function, so specifiers resolve from the working directory rather than from this package.

## License

MIT
