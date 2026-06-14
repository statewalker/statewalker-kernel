# @statewalker/platform.core

Type-only vocabulary of platform-capability commands shared by every application composed of `statewalker-workbench` fragments. A platform-specific implementation is provided by a peer fragment (`@statewalker/platform.browser` for browsers; future `platform-node` / `platform-electron`); this package stays free of runtime browser code and runs unchanged under Node.

## Why it exists

Fragments need a single, typed surface to ask the host environment to do environment-y things — pick a directory, save a file, copy to clipboard, persist a preference, sync URL state — without binding to any particular host. Keeping the contract here (and the implementations in `platform.browser` / future siblings) means a fragment that uses `runPickDirectory` works the same in a browser app, a Node test, and a future Electron build.

## Commands

Each command is a self-contained folder under `src/commands/` exporting four things: the string key constant, the payload / result type declarations, and the `run*` / `handle*` factory pair created via `@statewalker/shared-commands`.

| Folder | Key | Purpose |
|---|---|---|
| [`pick-directory/`](src/commands/pick-directory/) | `platform:pick-directory` | Ask the environment to present a directory picker; returns `{ files: FilesApi; label }`. |
| [`pick-file/`](src/commands/pick-file/) | `platform:pick-file` | File picker returning `{ blobs: Blob[]; names }`. |
| [`download-to-files/`](src/commands/download-to-files/) | `platform:download-to-files` | Stream a URL into a `FilesApi` path with optional resume + `AbortSignal`. |
| [`copy-to-clipboard/`](src/commands/copy-to-clipboard/) | `platform:copy-to-clipboard` | Copy text. |
| [`download-blob/`](src/commands/download-blob/) | `platform:download-blob` | Trigger a browser "Save As" for a `Blob`. |
| [`preference-get/`](src/commands/preference-get/) | `platform:preference-get` | Read a durable host-provided key/value pair. |
| [`preference-set/`](src/commands/preference-set/) | `platform:preference-set` | Write a durable host-provided key/value pair. |

`src/commands/index.ts` re-exports every folder; `src/index.ts` re-exports `./commands/index.ts` plus the adapters and `UrlStateView`.

## Adapters

The package owns three context-bound adapters consumed by every fragment:

```ts
import { getCommands, getUrlStateView } from "@statewalker/platform.core";

const commands = getCommands(ctx);          // Commands bus (auto-created on first access)
const urlState = getUrlStateView(ctx);    // URL ↔ state sync model
```

- **`Commands`** — the single `Commands` bus shared by every fragment in a composed app. Auto-creates on first access; no explicit bootstrap step.
- **`UrlStateView`** — bidirectional URL ↔ model state synchronisation. Fragments register `UrlSerializer`s; the browser binding (in `platform.browser`) flushes serialised state to `location.hash` and feeds incoming `hashchange` back. Auto-created on first access.

## Usage

```ts
import { getCommands, runPickDirectory } from "@statewalker/platform.core";

const { files, label } = await runPickDirectory(getCommands(ctx), {
  title: "Select workspace",
});
```

Registering a serializer with `UrlStateView`:

```ts
import { getUrlStateView, type UrlSerializer } from "@statewalker/platform.core";

const serializer: UrlSerializer = {
  serialize: (state) => ({ ...state, query: { ...state.query, session: activeSessionId } }),
  deserialize: (state) => switchToSession(state.query.session),
};

const dispose = getUrlStateView(ctx).register(serializer);
```

## Internals

- **Zero runtime DOM dependencies.** `UrlStateView` extends `BaseClass` and is built from observable primitives only; nothing in the package touches `window`, `document`, or any browser global.
- **Command-folder layout** — every command lives in its own folder so a future code-gen (e.g. JSON-RPC bindings) can iterate cleanly without text-grepping.
- **Loop prevention in `UrlStateView`** — a single `#syncing` flag blocks reentrancy: `applyUrl()` is a no-op while `sync()` is running, and vice versa.

## Related

- `@statewalker/platform.browser` — browser implementation of every command above plus `bindUrlState`.

## License

MIT — see the monorepo root `LICENSE`.
