# @statewalker/platform.browser

Browser implementation of `@statewalker/platform.core`. Provides default handlers for every `platform:*` command plus a `bindUrlState` helper that hooks `UrlStateView` to `location.hash`.

## Why it exists

`platform.core` declares the contract; *something* must satisfy it on each host. This package is the browser-side implementation — all logic that touches `window`, `document`, `navigator`, `localStorage`, `URL.createObjectURL`, `<input type="file">`, `showDirectoryPicker`, etc. lives behind the command boundary so consumer fragments stay platform-agnostic. Future `platform-node` / `platform-electron` packages would provide the same handlers against the same contract.

## Installation

```sh
pnpm add @statewalker/platform.browser
```

## Usage

The package's default export is `initPlatformWeb(ctx)`. Listing it as a manifest root activates every browser handler plus URL-state synchronisation in one shot:

```ts
import { bootstrap } from "@statewalker/backbone.browser";

await bootstrap(
  {
    roots: [
      "@statewalker/platform.browser",
      "@repo/app-shell/init-shadcn",
      "@repo/chat-app/fragment",
    ],
  },
  ctx,
);
```

Inside `initPlatformWeb`:

1. Resolves the shared `Commands` bus via `getCommands(ctx)`.
2. Registers handlers for `pick-directory`, `pick-file`, `download-to-files`, `copy-to-clipboard`, `download-blob`, `preference-get`, `preference-set`.
3. Resolves `getUrlStateView(ctx)` and registers `bindUrlState(view)` so `location.hash` and the model stay in sync without any consumer-side wiring.

Returns an async cleanup that unregisters everything in reverse order.

## Handlers

| Command | Implementation |
|---|---|
| `platform:pick-directory` | File System Access API `showDirectoryPicker()`, wrapped in `BrowserFilesApi`. |
| `platform:pick-file` | `showOpenFilePicker()` with `<input type="file">` fallback. |
| `platform:download-to-files` | Streaming `fetch` with `Range`-based resume, piped into `FilesApi.write`. |
| `platform:copy-to-clipboard` | `navigator.clipboard.writeText`. |
| `platform:download-blob` | Anchor + `URL.createObjectURL` trick. |
| `platform:preference-get` / `platform:preference-set` | `localStorage` under a `workbench:` prefix. |

## Hash routing helpers

```ts
import { bindUrlState, parseHash, buildHash } from "@statewalker/platform.browser";
import { getUrlStateView } from "@statewalker/platform.core";

const cleanup = bindUrlState(getUrlStateView(ctx));
```

`parseHash(hash)` and `buildHash(state)` are pure helpers — useful for tests or for app code that wants to read the current URL state without subscribing.

## Internals

- **Async cleanup.** `initPlatformWeb` returns the cleanup from `newRegistry()` (a `() => Promise<void>`); callers that depend on cleanup completion must `await` it. Tests in `tests/activate.browser.test.ts` show this.
- **One target per manifest.** The platform-side fragment is single-host: list `platform.browser` *or* a future `platform-node` / `platform-electron`, never multiple.
- **Handlers compose with the shell.** This package doesn't render UI; it satisfies a contract that other fragments call into.

## Related

- `@statewalker/platform.core` — the contract this package implements.

## License

MIT — see the monorepo root `LICENSE`.
