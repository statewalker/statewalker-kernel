# @statewalker/workspace.browser

Browser platform implementation of the workspace fragment: the File System
Access shell-state machine (`WorkspaceShellAdapter`), its orchestrating
`WorkspaceBridgeManager`, IndexedDB handle persistence, and the
`workspace:reconnect` / `workspace:disconnect` commands that complement the
canonical `workspace:change` from `@statewalker/workspace.core`.

## What it is

This package turns the React-free `Workspace` from `workspace.core` into a
running browser workspace backed by a real on-disk folder. It owns everything
that is specific to the [File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_API):
picking a directory, wrapping its handle as a `FilesApi`, persisting the handle
in IndexedDB so the workspace silently restores on reload, re-requesting
permission when the browser has forgotten the grant, and exposing the whole
lifecycle as a single observable state machine (`WorkspaceShellAdapter`) that a
renderer can subscribe to.

It ships **no React** — it is the `.browser` aspect in the
`{domain}` / `{domain}.browser` / `{domain}.view.react` split. The matching
renderer is `@statewalker/workspace.view.react`.

## Why it exists

`workspace.core` defines *what* a workspace is (an observable `FilesApi` host
with class-keyed capability adapters) and a canonical, host-neutral
`workspace:change` command. It deliberately knows nothing about browsers. But a
browser host needs four things `core` cannot provide:

1. **A handle, not just files.** `workspace.core`'s `workspace:change`
   ultimately defers to `platform:pick-directory`, which returns only
   `{ files, label }` and *loses* the underlying `FileSystemDirectoryHandle`.
   Without the handle there is nothing to persist, so a reload would force the
   user to re-pick every time. This package's manager picks the directory
   itself on the interactive path so it captures the handle.
2. **Persistence.** The handle is stored in IndexedDB (handles are
   structured-cloneable) so a reload can re-adopt the same folder.
3. **Permission lifecycle.** Browsers drop the grant between sessions. The
   manager queries permission on restore (`granted` → adopt silently,
   `prompt` → `needs-permission`, `denied` → forget) and re-requests it from a
   user gesture on `workspace:reconnect`.
4. **Observable shell state.** A renderer needs to know whether to show the
   onboarding picker, a reconnect prompt, an "unsupported browser" message, or
   the live workspace. `WorkspaceShellAdapter` is the single source of truth.

## How to use

```sh
pnpm add @statewalker/workspace.browser
```

The package is a **logic fragment**: its default export is an `init(ctx)`
function that the host's fragment loader calls once. `ctx` must already carry a
`Workspace` (set by `workspace.core`'s `setWorkspace`); `init` wires the bridge
to it and returns an async cleanup.

```ts
import initWorkspaceBridge from "@statewalker/workspace.browser/fragment";

// ctx already holds a Workspace via getWorkspace(ctx)
const cleanup = initWorkspaceBridge(ctx);
// …later, on teardown:
await cleanup();
```

Once initialised, the workspace silently restores any previously-picked folder.
Everything else is driven through the workspace's `Commands` adapter:

```ts
import { Commands } from "@statewalker/shared-commands";
import { getWorkspace } from "@statewalker/workspace.core";
import {
  ChangeWorkspaceCommand,
  WorkspaceReconnectCommand,
  WorkspaceDisconnectCommand,
  WorkspaceShellAdapter,
} from "@statewalker/workspace.browser";

const workspace = getWorkspace(ctx);
const commands = workspace.requireAdapter(Commands);

// Open the directory picker (must run from a user gesture).
await commands.call(ChangeWorkspaceCommand, {}).promise;

// Re-request permission on the stored handle (user gesture required).
await commands.call(WorkspaceReconnectCommand, {}).promise;

// Tear down + forget the stored handle.
await commands.call(WorkspaceDisconnectCommand, {}).promise;

// Read the current shell state.
const shell = workspace.requireAdapter(WorkspaceShellAdapter);
shell.getState(); // → { status: "ready", label: "my-folder" }, etc.
```

## Examples

### Subscribing to shell state (React-free)

`WorkspaceShellAdapter` extends `BaseClass`, so `onUpdate` fires on every
transition. The renderer package wraps this in a hook, but any consumer can
subscribe directly:

```ts
import { WorkspaceShellAdapter } from "@statewalker/workspace.browser";

const shell = workspace.requireAdapter(WorkspaceShellAdapter);
const off = shell.onUpdate(() => {
  const s = shell.getState();
  switch (s.status) {
    case "loading":          /* silent-restore in flight */ break;
    case "unsupported":      console.warn(s.reason);         break;
    case "empty":            /* show the picker */           break;
    case "needs-permission": /* offer "Reconnect <s.label>" */ break;
    case "ready":            console.log("open:", s.label);  break;
  }
});
```

### Non-interactive rebind (tests, integration harness, CLI)

`workspace:change` accepts a `files` payload to bind a workspace without a
browser dialog — the same code path silent-restore uses:

```ts
import { ChangeWorkspaceCommand } from "@statewalker/workspace.browser";
import { MemFilesApi } from "@statewalker/webrun-files";

await commands.call(ChangeWorkspaceCommand, {
  files: new MemFilesApi(),
  label: "scratch",
}).promise;
// shell adapter is now { status: "ready", label: "scratch" }
```

### The state machine

```
                          init() → constructor
                                  │
                          { status: "loading" }
                                  │  silent-restore
        ┌─────────────────┬──────┴───────┬──────────────────┐
   no showDirectory   no stored      query = "prompt"   query = "granted"
     Picker            handle             │                  │
        │                 │               │            adopt handle,
 "unsupported"        "empty"      "needs-permission"   open workspace
                                          │                  │
                              reconnect (user gesture)   onLoad →
                              request = granted →         "ready"
                              adopt → "ready"
```

`workspace:disconnect` from any state closes the workspace, clears IndexedDB,
and returns to `empty`.

## Internals

### Architectural decisions

- **Manager owns the wiring, the adapter owns the state (ADR 0004).**
  `WorkspaceShellAdapter` is a thin `BaseClass` holding only the discriminated
  state union. All orchestration — command handlers, the `onLoad` subscription,
  silent-restore, permission flows — lives in `WorkspaceBridgeManager`. This
  keeps the observable surface trivial and re-subscribable.
- **The adapter is self-hosted, never `setAdapter`-ed.** `init` calls
  `workspace.requireAdapter(WorkspaceShellAdapter)`, relying on
  `Workspace.getAdapter`'s "concrete class tokens self-host" fallback. Using
  `setAdapter` would re-create the instance on every re-entrant `init` cycle and
  orphan any subscriber (e.g. a mounted React tree) that captured the previous
  instance. The re-entrancy test guards exactly this.
- **Silent-restore runs from the constructor, not `onLoad`.** Restore must
  begin before the first `open()`, so the manager kicks off `_silentRestore()`
  as a floating promise during construction; the adapter sits in `loading`
  until it resolves.
- **A single `onLoad` listener drives `ready`.** Whether the workspace opens via
  silent-restore, an interactive pick, or a non-interactive `files` rebind, the
  one `workspace.onLoad` subscription sets the adapter to `ready` — there is no
  per-path duplication of the "we're open now" transition.
- **The interactive path bypasses `platform:pick-directory`.** It calls
  `window.showDirectoryPicker` directly so it can persist the captured handle —
  the whole reason this package exists.

### Algorithms

- **Permission tri-state restore.** On startup with a stored handle,
  `queryPermission({ mode: "readwrite" })` decides the branch: `granted` adopts
  immediately, `prompt` parks in `needs-permission` (a user gesture is required
  before the browser will prompt), `denied` clears the handle and falls back to
  `empty`.
- **Lifecycle order on every (re)bind.** `close()` → `initWorkspace({ filesApi,
  label })` → `open()`. Closing first flushes prior `onUnload` listeners before
  the new `FilesApi` is installed.

### Constraints

- **Chromium-only.** The File System Access API (`window.showDirectoryPicker`,
  handle `queryPermission`/`requestPermission`) is currently Chromium-only;
  elsewhere the adapter reports `unsupported`.
- **User-gesture rules.** `ChangeWorkspaceCommand` (interactive) and
  `WorkspaceReconnectCommand` must be fired from a user gesture, or the browser
  rejects the picker / permission prompt.
- **Single workspace handle.** Exactly one handle is persisted, under the
  IndexedDB key `chat-mini:workspace-handle`. There is no multi-folder history.

### Dependencies

- `@statewalker/workspace.core` — the
  `Workspace` class, `getWorkspace`, `initWorkspace`, and the canonical
  `ChangeWorkspaceCommand` re-exported here.
- `@statewalker/webrun-files` / `@statewalker/webrun-files-browser` — the
  `FilesApi` contract and its `BrowserFilesApi` directory-handle implementation.
- `@statewalker/shared-commands` — the `Commands` adapter and the
  `Command.silent(...).input().output().build()` builder for reconnect/disconnect.
- `@statewalker/shared-baseclass` — `BaseClass`, the observable base of
  `WorkspaceShellAdapter`.
- `@statewalker/shared-registry` — `newRegistry` for grouped listener cleanup.
- `idb-keyval` — minimal IndexedDB get/set/del for the persisted handle.

## Related

- `@statewalker/workspace.core` — the React-free
  workspace logic this package implements for the browser.
- `@statewalker/workspace.view.react` — the
  React renderer that subscribes to `WorkspaceShellAdapter` and fires these
  commands.

## License

MIT — see the monorepo root `LICENSE`.
