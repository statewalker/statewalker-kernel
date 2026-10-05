# @statewalker/platform.core

## What it is

The contract for host capabilities: pick a directory or files, download, copy to the clipboard, read and write durable preferences, and keep application state in the URL. Each capability is a command declaration for the workspace's `Commands` bus (`@statewalker/shared-commands`). This package declares them; `@statewalker/platform.browser` and `@statewalker/platform.node` answer them.

## Why it exists

Fragments need to ask the host for things like "let the user choose a folder" without knowing whether they run in a browser tab, a Node test or another shell. Putting the typed contract here, with no host code, lets a fragment call `PickDirectoryCommand` the same way everywhere, and lets tests register fake handlers. The package touches no `window`, `document` or other browser global, so it runs unchanged in Node.

## How to use

```sh
pnpm add @statewalker/platform.core
```

1. Make sure a host implementation is active (for example `@statewalker/platform.browser` as a manifest root).
2. Get the bus with `getCommands(ctx)`.
3. Call a declaration: `getCommands(ctx).call(Declaration, payload).promise`.

| Declaration | Key | Payload -> result |
| --- | --- | --- |
| `PickDirectoryCommand` | `platform:pick-directory` | `{ title? }` -> `{ files: FilesApi; label }` |
| `PickFileCommand` | `platform:pick-file` | `{ title?, accept?, multiple? }` -> `{ blobs: Blob[]; names: string[] }` |
| `DownloadToFilesCommand` | `platform:download-to-files` | `{ url, files, path, resume?, onProgress?, signal? }` -> `{ bytes }` |
| `CopyToClipboardCommand` | `platform:copy-to-clipboard` | `{ text }` -> `void` |
| `DownloadBlobCommand` | `platform:download-blob` | `{ blob, filename }` -> `void` |
| `PreferenceGetCommand` | `platform:preference-get` | `{ key }` -> `{ value }` |
| `PreferenceSetCommand` | `platform:preference-set` | `{ key, value }` -> `void` |

Each key is also exported as a constant (`PICK_DIRECTORY_COMMAND_KEY`, `PICK_FILE_COMMAND_KEY`, `DOWNLOAD_TO_FILES_COMMAND_KEY`, `COPY_TO_CLIPBOARD_COMMAND_KEY`, `DOWNLOAD_BLOB_COMMAND_KEY`, `PREFERENCE_GET_COMMAND_KEY`, `PREFERENCE_SET_COMMAND_KEY`), with payload and result types named after the command (`PickDirectoryPayload`, `PickDirectoryResult`, ..., `DownloadProgress`). `FilesApi` is from `@statewalker/webrun-files`.

## Examples

Ask for a directory and handle cancellation:

```ts
import { getCommands, isUserCancelled, PickDirectoryCommand } from "@statewalker/platform.core";

try {
  const { files, label } = await getCommands(ctx).call(PickDirectoryCommand, {
    title: "Select workspace",
  }).promise;
} catch (error) {
  if (!isUserCancelled(error)) throw error;
}
```

Store a preference:

```ts
import { getCommands, PreferenceGetCommand, PreferenceSetCommand } from "@statewalker/platform.core";

const commands = getCommands(ctx);
await commands.call(PreferenceSetCommand, { key: "theme", value: "dark" }).promise;
const { value } = await commands.call(PreferenceGetCommand, { key: "theme" }).promise;
```

Download into a `FilesApi` with progress:

```ts
import { DownloadToFilesCommand, getCommands } from "@statewalker/platform.core";

const controller = new AbortController();
const { bytes } = await getCommands(ctx).call(DownloadToFilesCommand, {
  url: "https://example.com/model.bin",
  files,
  path: "/models/model.bin",
  resume: true,
  onProgress: ({ loaded, total }) => console.log(loaded, total),
  signal: controller.signal,
}).promise;
```

Keep state in the URL:

```ts
import { getUrlStateView, type UrlSerializer } from "@statewalker/platform.core";

const serializer: UrlSerializer = {
  serialize: (state) => ({ ...state, query: { ...state.query, session: activeSessionId } }),
  deserialize: (state) => switchToSession(state.query.session),
};

const view = getUrlStateView(ctx);
const unregister = view.register(serializer);
view.sync(); // the host binding writes view.buildState() to the URL
```

Signal cancellation from a handler:

```ts
import { UserCancelledError } from "@statewalker/platform.core";

command.reject(new UserCancelledError());
```

## Internals

### A call with no handler waits forever

Every declaration uses the `silent` dispatch policy of `@statewalker/shared-commands`: when no handler is registered at call time, the call neither resolves nor rejects, and a handler registered later does not pick it up. On a host that does not implement a command (for example the pickers or the clipboard under `@statewalker/platform.node`), or when the call is made before the host fragment has started, `await ...promise` hangs with no error. Start the platform fragment before the fragments that call it, and guard calls with a timeout where the host may lack the command.

### Cancellation is a type, not a string

`UserCancelledError` (`name === "UserCancelledError"`) and `isUserCancelled(error)` let callers tell "the user closed the dialog" from a real failure with one `instanceof` check, instead of matching `AbortError` names or messages.

### The bus and the URL view are per workspace or per context

`getCommands(ctx)` returns `getWorkspace(ctx).requireAdapter(Commands)` from `@statewalker/workspace.core`, created on first use, so all fragments under one workspace share one bus. `setCommands` and `removeCommands` are kept only so old start-up code compiles; they do nothing except log `[platform-api] setCommands is deprecated and a no-op: ...`.

`getUrlStateView(ctx)` (with `setUrlStateView` and `removeUrlStateView`) stores a `Navigation` instance (also exported as `UrlStateView`) under the context key `model:url-state`. `Navigation` extends `BaseClass` from `@statewalker/shared-baseclass`; `sync()` notifies `onUpdate` listeners, `buildState()` folds all serializers over `{ path: "", query: {} }`, and `applyUrl(state)` feeds an incoming URL state to every serializer. One `#syncing` flag blocks re-entry, so a write to the URL never triggers a read back into the model in the same turn, and the reverse.

### Dependencies

`@statewalker/shared-commands` (command declarations and bus), `@statewalker/workspace.core` (the workspace that owns the bus), `@statewalker/shared-adapters` and `@statewalker/shared-baseclass` (the URL view adapter and its observable base), `@statewalker/webrun-files` (the `FilesApi` type in payloads).

## License

MIT
