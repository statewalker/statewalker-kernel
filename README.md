# statewalker-kernel

## What it is

The kernel of a StateWalker application and its React shell. `packages/` holds the headless packages that start an application from a manifest (`backbone.*`), hold the workspace and its files (`workspace.*`), declare host capabilities (`platform.*`), and keep the state of the dock, panels, file explorer, settings and web-app projects; nothing there renders UI or depends on React. `packages-react/` holds the React renderers of that state: the substrate, the dock shell, the shadcn primitives, and the render, settings and inline views. `fragments/` holds the platform's core fragments, so far `system.commands` and `system.workbench`, and `apps/` the demo applications, so far `notes`. All packages but `kernel.core` and the core fragments (private for now) are published to npm under `@statewalker/*`.

## The shape

```
packages/
  kernel.core                                                fragment manifests, lifecycle and extension registry (private for now)
  client.core                                                the client API fragments' client halves import (private for now)
  backbone.core      backbone.browser   backbone.node       start an app from an AppManifest
  workspace.core     workspace.browser                       Workspace, files, adapters
  workspace-vcs.core                                         git as an opt-in project nature
  platform.core      platform.browser   platform.node       host capabilities as commands
  render.core  shell.core  mime.core  explorer.core          panel specs, dock, file viewers, explorer
  inline.core  settings.core                                 inline content, settings
  webapp.core        webapp.browser                          web-app projects served from a ServiceWorker
packages-react/
  ui.view.react      ui.view.shadcn                          React substrate (mount, hooks), shadcn primitives
  shell.view.react   render.view.react                       the dock shell (dockview-react), json-render boundary
  settings.view.react  inline.view.react                     settings dialog, inline content
fragments/
  system.commands                                            the command bus, commands and keybindings points (private for now)
  system.workbench                                           the views point, the workbench model and its dockview (private for now)
apps/
  notes                                                      the notes demo: the shell tracer, in the browser (private)
scripts/                                                     maintenance scripts (see Reference)
tests/                                                       repository-level tests (no-React rule, release coverage)
```

The suffix says where a package runs: `.core` runs anywhere (no DOM, no Node built-ins), `.browser` needs a browser, `.node` needs Node.

Main runtime dependencies between the packages (arrows point at the dependency; some edges omitted):

```
backbone.browser ─┐
backbone.node ────┴─> backbone.core                      (no other dependencies)

kernel.core                                              (shared-slots only)
system.commands ─> kernel.core                           (and shared-commands)
system.workbench ─> kernel.core                          (client half: dockview-react, React)
client.core                                              (no dependencies)
apps/notes ─> system.workbench, system.commands, client.core, ui.view.shadcn

platform.browser ─┐
platform.node ────┴─> platform.core ─────────────┐
workspace.browser ───────────────────────────────┤
workspace-vcs.core ──────────────────────────────┤
settings.core ───────────────────────────────────┤
explorer.core ─> mime.core ─> shell.core ─> render.core ─> workspace.core
webapp.browser ─> webapp.core ───────────────────┘
inline.core                                              (shared-* only)
```

The React packages, on top of those:

```
shell.view.react ──┬─> render.view.react                (@json-render/react)
                   ├─> render.core, shell.core
settings.view.react┼─> settings.core, shell.core
inline.view.react ─┼─> inline.core, mime.core
                   └─> ui.view.react ─> ui.view.shadcn  (Radix, Tailwind v4 classes)
                            └─> workspace.core, workspace.browser
```

| Package | What it does | npm |
| --- | --- | --- |
| [kernel.core](packages/kernel.core) | The platform kernel: validates `fragment.jsonc` against its versioned JSON Schema, refuses what this host cannot run, and keeps the fragment lifecycle (installed, enabled, resolved, active per aspect) as membership in the `system:fragments:*` keyed slots, and routes extensions (static and runtime, dormant until their owner arrives, validated against the point's schema, with lazy references) to the extension points' owners. | not published yet |
| [system.commands](fragments/system.commands) | The first core fragment: declares the `commands` and `keybindings` points; calls commands declared as OpenAPI operations on the bus (input and output checked against their schemas, typed errors), and projects the opt-in `agent` and `mcp` exposures to harness tool documents and MCP tools. | not published yet |
| [system.workbench](fragments/system.workbench) | The core fragment owning the workbench: declares the `views` point, keeps which views exist and which are open (a view closes when its fragment leaves), and renders them as one dockview with the shadcn tokens; prebuilt CSS without preflight, and the tokens for fragments' CSS. | not published yet |
| [client.core](packages/client.core) | The client API a fragment's client half imports by bare specifier (shared through the shell's import map): the command bus, installed by the shell at boot. | not published yet |
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
| [ui.view.react](packages-react/ui.view.react) | React substrate: `mount`, `AppRoot`, the `core:views` slot, slot and adapter hooks, theme binding. | [@statewalker/ui.view.react](https://www.npmjs.com/package/@statewalker/ui.view.react) |
| [ui.view.shadcn](packages-react/ui.view.shadcn) | shadcn primitives (Radix) and the `cn()` helper. | [@statewalker/ui.view.shadcn](https://www.npmjs.com/package/@statewalker/ui.view.shadcn) |
| [shell.view.react](packages-react/shell.view.react) | The dock: dockview-react host, `MainShell`, `ShellHeader`, `JsonPanel`. | [@statewalker/shell.view.react](https://www.npmjs.com/package/@statewalker/shell.view.react) |
| [render.view.react](packages-react/render.view.react) | The only `@json-render/react` boundary: `<SpecRenderer spec registry>`. | [@statewalker/render.view.react](https://www.npmjs.com/package/@statewalker/render.view.react) |
| [settings.view.react](packages-react/settings.view.react) | Settings dialog and header button. | [@statewalker/settings.view.react](https://www.npmjs.com/package/@statewalker/settings.view.react) |
| [inline.view.react](packages-react/inline.view.react) | Renders components embedded in content. | [@statewalker/inline.view.react](https://www.npmjs.com/package/@statewalker/inline.view.react) |

Every package is public except `kernel.core`, `client.core`, `system.commands` and `system.workbench`, which stay private until their names are confirmed and their first versions published. The one app so far, [apps/notes](apps/notes), is private: it boots the platform in the browser and carries the browser tests (seam 2, Playwright).

This repository is becoming the platform (statewalker-platform, specified in statewalker/statewalker-root#215), so it takes the platform's layout. `packages/` holds only UI-free, isomorphic packages: `lint:check` fails on any `react` or `react-dom` import there (a Biome rule) and on React entering without an import (`scripts/check-no-react.mjs`: `.tsx`/`.jsx` files, a tsconfig `jsx` option, React in a `package.json`); `tests/no-react-in-packages.test.ts` checks both. A core fragment's `src/` is React-free the same way (React imports and `.tsx`/`.jsx` files fail there), while its `client/` folder, the client aspect's default folder, may use React. React code goes to `packages-react/` or a fragment's `client/`, the core fragments to `fragments/` and the demos to `apps/`. The six React packages came from statewalker-shell-react (statewalker/statewalker-root#245) with their names and versions; the views of integration fragments (explorer, MIME viewers, workspace, web app, AI configuration) stay there for now.

Dependencies from outside the repository, by package: `@statewalker/shared-adapters`, `shared-baseclass`, `shared-commands`, `shared-logger`, `shared-logger-pino`, `shared-registry`, `shared-slots`; `@statewalker/webrun-files` and its `-browser`, `-node`, `-mem`, `-composite` backends, `webrun-builder`, `webrun-modules`; `@statewalker/webrun-site-builder`, `webrun-site-host`; `@statewalker/vcs-*` (used by `workspace-vcs.core`); `semver`, `jsonc-parser` and `@cfworker/json-schema` (used by `kernel.core`; the last also by `system.commands`); `vite`, `tailwindcss` with `@tailwindcss/cli`, and `playwright` (the build and browser tests of `apps/notes`; the CLI also builds `system.workbench`'s CSS).

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

State and behaviour live in `packages/`; React views live in the `*.view.react` packages of `packages-react/`, which depend on them. Because of that split, every package is tested with vitest in Node (`packages/`) or jsdom (`packages-react/`), without a browser.

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
- **The `./styles` entries of the React packages are CSS only.** They have no types by design; `.attw.json` tells attw (CI's `package-checks`) to skip them. Tailwind v4 in the consuming app picks up the classes through each `styles.css`'s `@source` globs.
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

Merging the version pull request publishes (`.github/workflows/ci.yml`, jobs `version`, `pack` and `publish`). `pack` walks `packages/`, `packages-react/` and `fragments/`; `tests/release-coverage.test.ts` fails when a public package sits where neither the workspace globs nor that loop reach. After CI passes on `main`, the `version` job adds changesets for packages whose packed contents differ from npm's `latest` and opens or updates a "chore: version packages" pull request that applies all pending changesets; merging it packs what npm lacks, and `publish` uploads it with npm trusted publishing and provenance and tags a GitHub release per package. To choose the bump or the changelog text yourself, add a changeset with `pnpm changeset` in your pull request.

One-time set-up: npm's trusted publisher for each package names this repository, `ci.yml` and the `npm` environment (only `main`, no required reviewers); the `statewalker-release` GitHub App opens the version pull request, so its checks run. A package npm has never seen fails `publish` with a 404 until its first version is published by hand.

### License

MIT, see [LICENSE](LICENSE).
