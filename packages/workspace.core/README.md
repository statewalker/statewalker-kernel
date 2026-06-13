# @statewalker/workspace

Workspace logic fragment: the `Workspace` class, its system/secrets/settings adapters, the `workspace:change` command, and the registrar init that wires the change-handler.

## Workspace → project → resource model

The package also hosts the class-keyed `workspace → project → resource`
hierarchy (the consolidation of `@statewalker/resources-workspace`):

- **`Adaptable`** (extends `BaseClass`) — the observable, class-keyed adapter
  host. `Workspace`, `Project`, and `Resource` all extend it. Adapter
  **instances are cached strongly** per handle; resolution order is
  handle-local registration → level-scoped factory in the shared
  `AdaptersRegistry` → concrete self-host.
- **`AdaptersRegistry`** — level-aware factory store (workspace / project /
  resource), exposed via `Workspace.adaptersRegistry`.
- **`Workspace`** owns the `FilesApi` and two bounded LRUs — `getResource(path)`
  (keyed by full path) and `getProject(name)` / `listProjects()` (keyed by
  project name).
- **Derived values** use weak-ref, dependency-tracked `Reference<{value}>`
  (`newReference`) — see `TextAdapter.textRef` → `JsonAdapter.jsonRef`. Only
  *values* are weak; adapter *instances* are strong.

> **Transitional:** `@statewalker/resources-workspace` and
> `@statewalker/resources-wiki` still exist and build unchanged; the wiki
> migration onto this model and the deletion of `resources-workspace` are a
> follow-up step. `ProjectBuilder` (the signal-driven build engine + `BuilderProvider`
> "nature") is being ported here next.

## What it exports

- **`Workspace` class** — observable workspace with a primary `FilesApi`
  (the directory the user picked) plus a class-keyed registry of capability
  adapters (`SystemFiles`, `Secrets`, `Settings`, etc.). Lifecycle:
  constructed closed, configured via chainable `setAdapter` /
  `setFileSystem`, transitioned with `open()` / `close()`. Subscribers use
  `onLoad` / `onUnload` for per-open work and `BaseClass.onUpdate` for
  state transitions.
- **`getWorkspace` / `setWorkspace` adapter** (registry key
  `workspace:workspace`) — the single place a host app stores the
  `Workspace` instance for every fragment to consume.
- **Adapter tokens** — `SystemFiles`, `Secrets`, `Settings` abstract classes
  used as `Workspace.requireAdapter(SystemFiles)` keys, plus the
  `FilesBackedSystemFiles` / `FilesBackedSecrets` / `FilesBackedSettings`
  default implementations registered by `initWorkspace(...)`.
- **`initWorkspace(opts)`** — constructor helper that wires a fresh
  `Workspace` (or a passed-in instance) to a `FilesApi` and the default
  files-backed adapters. Used by hosts that build the workspace before
  activation.
- **`workspace:change` command** — `runChangeWorkspace(commands, { files?, label? })`.
  When `files` is supplied, rebinds non-interactively. When absent, opens
  the unified request-file-system dialog. The handler is registered by the
  package's default-exported fragment-init.
- **`platform:pick-directory` command re-declaration** — `runPickDirectory`,
  `handlePickDirectory`. Re-declared locally (not imported from
  `@statewalker/platform-api`) to avoid a cyclic dependency.
- **`init(ctx) → cleanup`** (default export, also at `./fragment`) —
  registers the `workspace:change` handler against the workspace's
  `Commands` adapter.

## Companion packages

- [`@statewalker/workspace-bridge`](../workspace-bridge/README.md) —
  shell-side wiring for the workspace: menu item, dialog renderer,
  reconnect / disconnect commands.
- [`@statewalker/workspace-bridge-react`](../workspace-bridge-react/README.md) —
  the renderer-side bridge surfaces (`AppWorkspaceProvider`,
  `DirectoryPickerEmptyState`, `ReconnectBanner`, switch-workspace header
  item).
