# statewalker-kernel

## What it is

The headless kernel of a StateWalker application: the packages that start an application from a manifest (`backbone.*`), hold the workspace and its files (`workspace.*`), declare host capabilities (`platform.*`), and keep the state of the dock, panels, file explorer, settings and web-app projects. Nothing here renders UI or depends on React; renderers live in separate `*.view.react` packages that read this state. All packages are published to npm under `@statewalker/*`.

## The shape

```
packages/
  backbone.core      backbone.browser   backbone.node       start an app from an AppManifest
  workspace.core     workspace.browser                       Workspace, files, adapters
  workspace-vcs.core                                         git as an opt-in project nature
  platform.core      platform.browser   platform.node       host capabilities as commands
  render.core  shell.core  mime.core  explorer.core          panel specs, dock, file viewers, explorer
  inline.core  settings.core                                 inline content, settings
  webapp.core        webapp.browser                          web-app projects served from a ServiceWorker
scripts/                                                     maintenance scripts (see Reference)
```

The suffix says where a package runs: `.core` runs anywhere (no DOM, no Node built-ins), `.browser` needs a browser, `.node` needs Node.

Main runtime dependencies between the packages (arrows point at the dependency; some edges omitted):

```
backbone.browser ─┐
backbone.node ────┴─> backbone.core                      (no other dependencies)

platform.browser ─┐
platform.node ────┴─> platform.core ─────────────┐
workspace.browser ───────────────────────────────┤
workspace-vcs.core ──────────────────────────────┤
settings.core ───────────────────────────────────┤
explorer.core ─> mime.core ─> shell.core ─> render.core ─> workspace.core
webapp.browser ─> webapp.core ───────────────────┘
inline.core                                              (shared-* only)
```

| Package | What it does | npm |
| --- | --- | --- |
| [backbone.core](packages/backbone.core) | `AppManifest`, module resolution and the fragment activation loop. No dependencies. | [@statewalker/backbone.core](https://www.npmjs.com/package/@statewalker/backbone.core) |
| [backbone.browser](packages/backbone.browser) | Browser bootstrap: bundler mode or runtime import maps with es-module-shims. | [@statewalker/backbone.browser](https://www.npmjs.com/package/@statewalker/backbone.browser) |
| [backbone.node](packages/backbone.node) | Node bootstrap and the `backbone-start` / `backbone-watch` scripts. | [@statewalker/backbone.node](https://www.npmjs.com/package/@statewalker/backbone.node) |
| [workspace.core](packages/workspace.core) | The `Workspace`: files, projects, adapters, logging. | [@statewalker/workspace.core](https://www.npmjs.com/package/@statewalker/workspace.core) |
| [workspace.browser](packages/workspace.browser) | Opens a browser directory as the workspace and keeps it across reloads. | [@statewalker/workspace.browser](https://www.npmjs.com/package/@statewalker/workspace.browser) |
| [workspace-vcs.core](packages/workspace-vcs.core) | Git for a workspace project: init, add, commit, log, status, HTTP remotes. | [@statewalker/workspace-vcs.core](https://www.npmjs.com/package/@statewalker/workspace-vcs.core) |
| [platform.core](packages/platform.core) | Host capabilities (pickers, downloads, clipboard, preferences, URL state) as command declarations. | [@statewalker/platform.core](https://www.npmjs.com/package/@statewalker/platform.core) |
| [platform.browser](packages/platform.browser) | Browser handlers for the platform commands. | [@statewalker/platform.browser](https://www.npmjs.com/package/@statewalker/platform.browser) |
| [platform.node](packages/platform.node) | Node handlers for the preference commands. | [@statewalker/platform.node](https://www.npmjs.com/package/@statewalker/platform.node) |
| [render.core](packages/render.core) | Panel spec store, saved dock layout, renderer catalogs. | [@statewalker/render.core](https://www.npmjs.com/package/@statewalker/render.core) |
| [shell.core](packages/shell.core) | Dock state and the show/close/focus panel commands. | [@statewalker/shell.core](https://www.npmjs.com/package/@statewalker/shell.core) |
| [mime.core](packages/mime.core) | Chooses a viewer for a file by MIME type; `files:open` / `files:visualize`. | [@statewalker/mime.core](https://www.npmjs.com/package/@statewalker/mime.core) |
| [explorer.core](packages/explorer.core) | File explorer state: navigation, tree, search, file commands. | [@statewalker/explorer.core](https://www.npmjs.com/package/@statewalker/explorer.core) |
| [inline.core](packages/inline.core) | Types and slot for components embedded in content. | [@statewalker/inline.core](https://www.npmjs.com/package/@statewalker/inline.core) |
| [settings.core](packages/settings.core) | Settings sections and their state. | [@statewalker/settings.core](https://www.npmjs.com/package/@statewalker/settings.core) |
| [webapp.core](packages/webapp.core) | Web-app projects: convention detection, config, module-server cache. | [@statewalker/webapp.core](https://www.npmjs.com/package/@statewalker/webapp.core) |
| [webapp.browser](packages/webapp.browser) | Serves a web-app project from a ServiceWorker with cross-origin isolation headers. | [@statewalker/webapp.browser](https://www.npmjs.com/package/@statewalker/webapp.browser) |

Every package is public; there are no private packages or apps in this repository.

Dependencies from outside the repository, by package: `@statewalker/shared-adapters`, `shared-baseclass`, `shared-commands`, `shared-logger`, `shared-logger-pino`, `shared-registry`, `shared-slots`; `@statewalker/webrun-files` and its `-browser`, `-node`, `-mem`, `-composite` backends, `webrun-builder`, `webrun-dataflow`, `webrun-modules`; `@statewalker/webrun-site-builder`, `webrun-site-host`; `@statewalker/vcs-*` (used by `workspace-vcs.core`).

## How to run it

Requirements: Node 24 and pnpm 10 through corepack (the version is pinned in `packageManager`).

1. `corepack enable`
2. `pnpm install`
3. `pnpm run build` — builds every package's `dist/` with tsdown, dependencies first.
4. `pnpm run test` — vitest in every package.
5. `pnpm run typecheck` — `tsc --noEmit` in every package. Needs step 3 (see below).
6. `pnpm run lint:check` and `pnpm run format:check` — Biome, as CI runs them. `pnpm run lint` and `pnpm run format` apply the fixes.

To work on one package: `pnpm --filter @statewalker/platform.browser test` (or `build`, `typecheck`, `test:watch` where the package defines it).

## Why it is the way it is

### No UI code in the kernel

State and behaviour live here; React views live in `*.view.react` packages that depend on these packages. Because of that split, every package here is tested with vitest in Node or jsdom, without a browser.

### Packages publish built code and their sources

Each package's `exports` point at `dist/` (JavaScript plus `.d.ts`, built by tsdown without bundling), and also carry a `source` condition that points at `src/*.ts`. `src/` is in `files`, so the sources ship to npm too. Consumers get plain JavaScript; tools that resolve the `source` condition, such as the vitest configs here, run against TypeScript without a build.

### The backbone depends on nothing else

`backbone.*` packages may depend at runtime only on each other. `backbone.core` vendors the small logger it needs instead of depending on `@statewalker/shared-logger`. `scripts/check-backbone-isolation.ts` checks the rule; CI does not run it.

### Fragments talk through commands and slots, not imports

Most `.core` packages export a `./fragment` entry (an `init(ctx)` for the backbone) and communicate through the workspace's `Commands` bus (`@statewalker/shared-commands`) and slots (`@statewalker/shared-slots`). A fragment can be replaced, or run without its UI, as long as someone answers the same commands.

## What will surprise you

- **`pnpm run typecheck` fails on a fresh clone** with `TS2307: Cannot find module '@statewalker/workspace.core' or its corresponding type declarations`. `tsc` reads sibling packages' types from their `dist/`, which only exists after `pnpm run build`. Tests do not have this problem, because vitest resolves the `source` condition.
- **A command that never returns.** Every command declared here uses the `silent` dispatch policy: if no fragment handles the command when it is called, the promise never settles and nothing is logged. Check that the fragment that handles it is in the manifest and starts first.
- **Fragments missing at runtime after installing from npm.** The backbone follows only `workspace:` dependencies to find fragments. In an installed (non-workspace) project, list every fragment in the manifest's `roots`.
- **`pnpm run lint:check` prints warnings.** Accessibility rules are set to `warn` in `biome.json`; warnings do not fail the check.
- `turbo.json` exists, but the root scripts use `pnpm -r`, which already runs packages in dependency order.

## Reference

### Commands

| Command | Does |
| --- | --- |
| `pnpm run build` | `pnpm -r run build` (tsdown) |
| `pnpm run test` | `pnpm -r run test` (vitest) |
| `pnpm run typecheck` | `pnpm -r run typecheck` (`tsc --noEmit`) |
| `pnpm run lint` / `lint:check` | `biome check --write .` / `biome check .` |
| `pnpm run format` / `format:check` | `biome format --write .` / `biome format .` |
| `pnpm changeset` | Record a version bump and changelog entry for your change. |
| `pnpm exec tsx scripts/check-backbone-isolation.ts` | Check that `backbone.*` declares no runtime `@statewalker/*` dependency other than `backbone.*`. |

`scripts/scaffold-substrate.sh` creates empty package skeletons and is not needed for normal work.

### Conventions

- Workspace packages refer to each other with `workspace:^`. External versions come from the catalog in `pnpm-workspace.yaml` (`catalog:`).
- Biome 2 formats and lints everything (2 spaces, double quotes, 100 columns).

### Releases

Packages are published to npm from CI with changesets and npm provenance. After CI passes on `main`, a release job adds changesets for packages whose packed contents differ from the published version and opens a "chore: version packages" pull request; merging it publishes. To choose the bump or the changelog text yourself, add a changeset with `pnpm changeset` in your pull request.

### License

MIT, see [LICENSE](LICENSE).
