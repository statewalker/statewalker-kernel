# @statewalker/workspace.browser

## What it is

The browser binding for the workspace from `@statewalker/workspace.core`, built on the [File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_API). It lets the user pick a folder, wraps the directory handle as a `FilesApi` (`BrowserFilesApi` from `@statewalker/webrun-files-browser`), stores the handle in IndexedDB so the same folder reopens after a reload, asks for permission again when the browser has dropped it, and exposes the whole lifecycle as one observable state (`WorkspaceShellAdapter`). It adds the `workspace:reconnect` and `workspace:disconnect` commands and its own handler for `workspace:change`. No React; `@statewalker/workspace.view.react` renders it.

## Why it exists

`workspace.core` defines the workspace and a host-neutral `workspace:change` command, but a browser host needs four things it cannot provide:

1. **The directory handle.** `platform:pick-directory` returns only `{ files, label }`; without the handle there is nothing to persist, and every reload would ask the user to pick again. This package calls the picker itself so it keeps the handle.
2. **Persistence.** Directory handles are structured-cloneable, so the handle is stored in IndexedDB and re-adopted on reload.
3. **Permission handling.** Browsers drop the grant between sessions. On restore the stored handle's permission is queried, and a user gesture can re-request it.
4. **One state for the UI.** A renderer must know whether to show the folder picker, a reconnect prompt, an "unsupported browser" message, or the open workspace. `WorkspaceShellAdapter` is that single source.

## How to use

```sh
pnpm add @statewalker/workspace.browser
```

No peer dependencies.

| Import | Contents |
| --- | --- |
| `@statewalker/workspace.browser` | `WorkspaceShellAdapter`, the commands, and (default export) the fragment init. |
| `@statewalker/workspace.browser/fragment` | Default export `initWorkspaceBridge(ctx)`; returns an async cleanup. |

Browser only (`window.showDirectoryPicker`, IndexedDB). ESM with `.d.ts`. The package ships `dist/` (built JS and types) and `src/` (TypeScript sources).

The workspace in `ctx` (`getWorkspace(ctx)` from `workspace.core`) must have a `Commands` adapter from `@statewalker/shared-commands`.

```ts
import initWorkspaceBridge from "@statewalker/workspace.browser/fragment";

const cleanup = initWorkspaceBridge(ctx); // starts restoring the stored folder
// on teardown:
await cleanup();
```

## Examples

Pick, reconnect and disconnect:

```ts
import { Commands } from "@statewalker/shared-commands";
import { getWorkspace } from "@statewalker/workspace.core";
import {
  ChangeWorkspaceCommand,
  WorkspaceDisconnectCommand,
  WorkspaceReconnectCommand,
} from "@statewalker/workspace.browser";

const commands = getWorkspace(ctx).requireAdapter(Commands);

await commands.call(ChangeWorkspaceCommand, {}).promise; // folder picker; call from a user gesture
await commands.call(WorkspaceReconnectCommand, {}).promise; // permission prompt; call from a user gesture
await commands.call(WorkspaceDisconnectCommand, {}).promise; // close and forget the folder
```

Bind a workspace without a dialog (tests, tools):

```ts
import { MemFilesApi } from "@statewalker/webrun-files-mem";

await commands.call(ChangeWorkspaceCommand, { files: new MemFilesApi(), label: "scratch" }).promise;
// shell state is now { status: "ready", label: "scratch" }
```

Follow the state (`WorkspaceShellAdapter` extends `BaseClass`, so `onUpdate` fires on every change):

```ts
import { WorkspaceShellAdapter } from "@statewalker/workspace.browser";

const shell = getWorkspace(ctx).requireAdapter(WorkspaceShellAdapter);
const off = shell.onUpdate(() => {
  const s = shell.getState();
  switch (s.status) {
    case "loading": break;           // restore in progress
    case "unsupported": break;       // s.reason
    case "empty": break;             // show the folder picker
    case "needs-permission": break;  // offer "Reconnect s.label"
    case "ready": break;             // s.label
  }
});
```

## Internals

### The state machine

```
                          init()
                            |
                    { status: "loading" }
                            |  restore
     +--------------+-------+-------+------------------+
 no showDirectory  no stored    query = "prompt"   query = "granted"
     Picker         handle           |                  |
     |                |              |            adopt handle,
"unsupported"      "empty"   "needs-permission"   open workspace
                                     |                  |
                         reconnect (user gesture)    "ready"
                         granted -> adopt -> "ready"
                         otherwise -> forget -> "empty"
```

A stored handle whose permission is `denied` is forgotten (`empty`). `workspace:disconnect` from any state closes the workspace, deletes the stored handle and returns to `empty`.

### Design decisions

- **The manager owns the wiring; the adapter only holds state.** `WorkspaceShellAdapter` is a `BaseClass` with one discriminated union. Command handlers, the `onLoad` subscription, restore and permission flows live in the internal `WorkspaceBridgeManager`.
- **The adapter is self-hosted, not `setAdapter`-ed.** `initWorkspaceBridge` calls `workspace.requireAdapter(WorkspaceShellAdapter)`, which constructs the concrete class once. `setAdapter` would replace the instance on every repeated `init` and leave existing subscribers (for example a mounted React tree) on a dead instance.
- **Restore starts in the constructor, not in `onLoad`.** It must run before the first `open()`; the adapter stays `loading` until it settles.
- **One `onLoad` listener sets `ready`.** Restore, interactive pick and `files` rebind all end in `workspace.open()`, and that single listener makes the transition.
- **Every rebind is close, then init, then open.** `workspace.close()` -> `initWorkspace({ workspace, filesApi, label })` -> `workspace.open()`, so `onUnload` listeners for the old folder run before the new `FilesApi` is installed.

### Constraints

- The File System Access API is available in Chromium-based browsers only. Elsewhere the state is `unsupported` with the reason `This browser does not support the File System Access API (Chromium-only at the moment).`
- The interactive `workspace:change` and `workspace:reconnect` must run from a user gesture, otherwise the browser rejects the picker or the permission prompt. The rejection is passed through as the command's error. Cancelling the picker also rejects the command.
- One handle is stored, under the IndexedDB key `chat-mini:workspace-handle`. There is no history of folders.
- This package registers its own `workspace:change` handler. The `./fragment` init of `workspace.core` registers one too, without handle persistence; if a host loads both, both listen for the same command.

### API reference

- `initWorkspaceBridge(ctx)` (default export) - returns `() => Promise<void>`.
- `WorkspaceShellAdapter` (`getState()`), type `WorkspaceShellState`.
- `ChangeWorkspaceCommand`, `ChangeWorkspacePayload`, `ChangeWorkspaceResult` - re-exported from `workspace.core`.
- `WorkspaceReconnectCommand` (`workspace:reconnect`, `WORKSPACE_RECONNECT_COMMAND_KEY`), `WorkspaceDisconnectCommand` (`workspace:disconnect`, `WORKSPACE_DISCONNECT_COMMAND_KEY`), `WorkspaceVoidPayload`, `WorkspaceVoidResult`.

### Dependencies

- `@statewalker/workspace.core` - `Workspace`, `getWorkspace`, `initWorkspace`, `ChangeWorkspaceCommand`.
- `@statewalker/webrun-files`, `@statewalker/webrun-files-browser` - the `FilesApi` contract and `BrowserFilesApi` over a directory handle.
- `@statewalker/shared-commands` - `Commands` and the command builder.
- `@statewalker/shared-baseclass` - observable base of `WorkspaceShellAdapter`.
- `@statewalker/shared-registry` - groups the listener disposers for cleanup.
- `idb-keyval` - minimal IndexedDB get/set/delete for the stored handle.

## License

MIT
