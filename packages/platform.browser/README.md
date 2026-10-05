# @statewalker/platform.browser

## What it is

The browser implementation of the `@statewalker/platform.core` commands. Its default export is a backbone fragment that registers a handler for every `platform:*` command on the workspace's `Commands` bus, binds the URL state view to `location.hash`, and installs a pino-backed logger for the workspace.

## Why it exists

`@statewalker/platform.core` only declares what a host must do. Something has to do it in a browser: open the File System Access pickers, write to the clipboard, save a blob, keep preferences in `localStorage`, and follow `hashchange`. Keeping all code that touches `window`, `document`, `navigator` and `localStorage` in this one package lets every other fragment stay host-independent and testable in Node.

## How to use

```sh
pnpm add @statewalker/platform.browser
```

Browser only. List it as a manifest root before the fragments that call platform commands, or call the default export yourself. Register only one platform implementation per application.

`initPlatformWeb(ctx)` does, in order:

1. `bindUrlState(getUrlStateView(ctx))`.
2. `registerPinoLogger(getWorkspace(ctx), { level })`, with `level` from `?logLevel=<level>` in the page URL, else `localStorage["statewalker:logLevel"]`, else `info`.
3. Registers the seven command handlers on `getCommands(ctx)`.

It returns a cleanup that undoes all of it. The cleanup returns a promise; await it when teardown order matters.

## Examples

As a manifest root:

```ts
import { bootstrap } from "@statewalker/backbone.browser";

const stop = await bootstrap(
  { roots: ["@statewalker/platform.browser", "@my/app-fragment"] },
  ctx,
);
```

Directly:

```ts
import initPlatformWeb from "@statewalker/platform.browser";

const cleanup = initPlatformWeb(ctx);
await cleanup();
```

Only some handlers, for example in a test page:

```ts
import { registerCopyToClipboardBrowser, registerPreferenceGetBrowser } from "@statewalker/platform.browser";
import { getCommands } from "@statewalker/platform.core";

const commands = getCommands(ctx);
const unregister = [registerCopyToClipboardBrowser(commands), registerPreferenceGetBrowser(commands)];
```

URL hash helpers:

```ts
import { bindUrlState, buildHash, parseHash } from "@statewalker/platform.browser";
import { getUrlStateView } from "@statewalker/platform.core";

const unbind = bindUrlState(getUrlStateView(ctx));
parseHash("#/docs?file=a.md"); // { path: "/docs", query: { file: "a.md" } }
buildHash({ path: "/docs", query: { file: "a.md" } }); // "#/docs?file=a.md"
```

Logger only:

```ts
import { registerPinoLogger } from "@statewalker/platform.browser";
import { getWorkspace } from "@statewalker/workspace.core";

const dispose = registerPinoLogger(getWorkspace(ctx), { level: "debug" });
```

## Internals

### What each handler uses

| Command | Function | Browser API |
| --- | --- | --- |
| `platform:pick-directory` | `registerPickDirectoryBrowser` | `showDirectoryPicker({ mode: "readwrite" })`, wrapped in `BrowserFilesApi` from `@statewalker/webrun-files-browser`. |
| `platform:pick-file` | `registerPickFileBrowser` | `showOpenFilePicker()`, falling back to a hidden `<input type="file">`. |
| `platform:download-to-files` | `registerDownloadToFilesBrowser` | Streaming `fetch` written with `files.write`; `resume: true` sends `Range: bytes=<existing size>-` and keeps the existing bytes; if the server ignores the range, the download starts over. |
| `platform:copy-to-clipboard` | `registerCopyToClipboardBrowser` | `navigator.clipboard.writeText`. |
| `platform:download-blob` | `registerDownloadBlobBrowser` | A temporary `<a download>` with `URL.createObjectURL`. |
| `platform:preference-get` / `-set` | `registerPreferenceGetBrowser` / `registerPreferenceSetBrowser` | JSON values in `localStorage` under the key prefix `workbench:`. |

Each `register*Browser(commands)` returns an unregister function.

### Where it fails, and what you see

- **Directory picker outside Chrome and Edge.** `showDirectoryPicker` is missing in Firefox and Safari; the call rejects with `showDirectoryPicker is not available in this environment`. There is no fallback.
- **Cancelled pickers behave differently.** A dismissed directory picker rejects with `UserCancelledError` from `@statewalker/platform.core`. A dismissed `showOpenFilePicker()` rejects with the browser's own `AbortError`. A cancelled `<input type="file">` resolves with empty `blobs` and `names`.
- **Clipboard.** `navigator.clipboard.writeText` needs a secure context and permission; otherwise the command rejects with the browser's error.
- **Download errors.** A non-2xx response rejects with `Download failed: <status> <statusText>`. An aborted `signal` rejects with the abort error.

### URL binding

`bindUrlState(view)` writes `buildHash(view.buildState())` to `location.hash` whenever the view notifies, feeds `hashchange` events to `view.applyUrl(parseHash(location.hash))`, and applies the current hash once on bind. Hash format: `#<path>?<key>=<value>&...`.

### Logging

`registerPinoLogger(workspace, options)` registers `PinoLoggerAdapter` for the workspace, project and resource levels. `@statewalker/shared-logger-pino` resolves to pino's browser build here, so logs go to `console` as structured objects. Each logger is a child carrying the host's metadata plus `name`.

### Dependencies

`@statewalker/platform.core` (the contract), `@statewalker/workspace.core` (workspace and logger adapter), `@statewalker/shared-commands` and `@statewalker/shared-registry` (bus and cleanup registry), `@statewalker/webrun-files` and `@statewalker/webrun-files-browser` (`FilesApi` over the File System Access API), `@statewalker/shared-logger` and `@statewalker/shared-logger-pino` (logging).

## License

MIT
