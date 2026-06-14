# @statewalker/shell.core

## What it is

The React-free logic half of the workbench application shell ("dock"). It owns the `dock:*` command surface (`show-panel` / `close-panel` / `focus-panel` / `set-panel-title`), the extension-point slots that describe the shell's chrome (`dock:side-panels`, `dock:header-items`, `dock:overlays`), and the `DockHost` workspace adapter — a thin, command-driven controller over a [`dockview-react`](https://dockview.dev/) `DockviewApi`. It contains no JSX; its renderer counterpart is `@statewalker/shell.view.react`.

## Why it exists

The workbench is assembled from independent fragments wired together through a `Workspace` (commands, slots, spec store). The shell is the frame those fragments dock into: a header strip, optional resizable side panels, a central tabbed dock area, and overlay mounts. Per ADR 0002, the shell is split into a logic package (this one) and a renderer package so that any fragment can *drive* the dock — open a panel, retitle a tab, contribute a side panel — by calling commands and contributing slot values, without importing React or knowing how DockView works.

`DockHost` solves a concrete boot-ordering problem: the `dock:*` command handlers are registered during boot (`init`), but the `<DockviewReact>` host only mounts later inside the React tree. Panel-open calls that fire in that window are queued and replayed once the api comes online.

## How to use

```sh
pnpm add @statewalker/shell.core
```

The package is consumed two ways:

1. **As a fragment** — its default export (`@statewalker/shell.core/fragment`) is an `init(ctx)` that attaches `DockHost` to the workspace and registers the four `dock:*` handlers. The host app activates it during boot.
2. **As a command/slot vocabulary** — other fragments import the command declarations and slot definitions to drive the shell or contribute chrome.

```ts
import { Commands } from "@statewalker/shared-commands";
import { ShowDockPanelCommand } from "@statewalker/shell.core";

const commands = workspace.requireAdapter(Commands);
await commands.call(ShowDockPanelCommand, {
  panelId: "file:/notes/todo.md",
  specId: "spec-abc",          // resolved by the renderer's JsonPanel via SpecStore
  title: "todo.md",
});
```

## Examples

### Open, focus, retitle, and close a panel

```ts
import { Commands } from "@statewalker/shared-commands";
import {
  ShowDockPanelCommand,
  FocusPanelCommand,
  SetPanelTitleCommand,
  ClosePanelCommand,
} from "@statewalker/shell.core";

const commands = workspace.requireAdapter(Commands);

// Open a panel docked to the right of an already-open reference panel.
await commands.call(ShowDockPanelCommand, {
  panelId: "preview",
  specId: "spec-preview",
  position: "right",
  referencePanelId: "editor",
});

await commands.call(SetPanelTitleCommand, { panelId: "preview", title: "Preview" });
await commands.call(FocusPanelCommand, { panelId: "preview" });
await commands.call(ClosePanelCommand, { panelId: "preview" });
```

`ShowDockPanelCommand` is idempotent on `panelId`: opening an already-open panel just focuses it (unless `activate: false`). All four commands are `Command.silent` and resolve once the dock mutation is applied; pre-mount `show-panel` calls resolve when the queued panel actually opens.

### Contribute shell chrome via slots

```ts
import { Slots } from "@statewalker/shared-slots";
import {
  dockSidePanelsSlot,
  dockHeaderItemsSlot,
  dockOverlaysSlot,
} from "@statewalker/shell.core";

const slots = workspace.requireAdapter(Slots);

// A left side panel; the renderer looks up `viewKey` in the `core:views` slot.
slots.provide(dockSidePanelsSlot, {
  id: "explorer",
  side: "left",
  order: 10,
  viewKey: "explorer:tree",
  defaultSize: "20%",
  minSize: "180px",
});

slots.provide(dockHeaderItemsSlot, {
  id: "workspace-switcher",
  slot: "leading",
  order: 0,
  viewKey: "workspace:switcher",
});

slots.provide(dockOverlaysSlot, {
  id: "settings-dialog",
  viewKey: "settings:dialog",
});
```

`viewKey` is data here — the logic side never holds a component. The renderer (`shell.view.react`) resolves each `viewKey` against `coreViewsSlot` at render time.

### Reading dock state directly

```ts
import { DockHost } from "@statewalker/shell.core";

const dock = workspace.requireAdapter(DockHost);
dock.getActivePanelId();                       // string | undefined
dock.getPanelIds();                            // readonly string[]
const off = dock.onActivePanelChange((id) => console.log("active:", id));
const offLayout = dock.onLayoutChange(() => console.log(dock.getPanelIds()));
```

## Internals

### Architectural decisions

- **Command-driven, not imperative.** Fragments never touch `DockviewApi`. They call `dock:*` commands; only `DockManager` (the fragment's orchestrator) listens for them and forwards to `DockHost`. This keeps the dock the single owner of panel lifecycle and tab semantics.
- **One panel kind.** The `show-panel` payload deliberately carries no DockView `component` field — every panel is rendered through the renderer's single `"json"` component, which resolves a spec from `render.core`'s `SpecStore`. New panel *kinds* are expressed as new specs/catalogs, not new DockView components.
- **Spec eviction on close.** `ClosePanelCommand` removes the panel and, when its `specId` is no longer referenced by any other open panel, deletes the spec from `SpecStore` — unless the spec record is marked `meta.persistent === true`. This prevents orphaned specs from accumulating while letting long-lived specs survive a close/reopen.
- **`DockManager` owns wiring, `DockHost` owns state.** Per the workbench's controller/manager split, the manager registers handlers and tears them down through a `newRegistry()` disposer set; the host holds the api, the pending queue, and the listener sets.

### Algorithms

- **Pre-mount queue.** `DockHost.showOrFocus` dispatches immediately if the api is attached, otherwise pushes `{ options, resolve }` onto a queue. `setApi` drains the queue synchronously (resolving each promise) before subscribing to layout/active-panel events.
- **Reference-panel anchoring.** When `referencePanelId` names an open panel, the new panel docks relative to it using `position` as the direction (default `"within"`, i.e. an extra tab in that group). If the reference panel is not open, placement falls back silently to the default.
- **Layout persistence + remount survival.** Layout is debounced to a microtask and written to `localStorage` (`chat-mini:dock-layout`). On `detach` the current layout is snapshotted in memory; the next `setApi` prefers that snapshot over the persisted copy, so React StrictMode / HMR remounts of `<DockviewReact>` don't lose panels added since the last persist.
- **Bus tracing.** `installBusTrace` is a no-op unless `localStorage["chat-mini:bus-trace"] === "1"`, in which case it monkey-patches `Commands.listen` and `Slots.provide` on the workspace instances to log registration and claim/dispatch. Zero overhead when disabled.

### Constraints

- Layout persistence is `localStorage`-keyed today; the code notes a planned move to `SystemFiles/dock-layout.json` once the workspace `open()`/`close()` lifecycle is wired up. `DockManager` is consequently one-shot (no re-entrant `onLoad`/`onUnload`).
- `getActivePanelId()` / `getPanelIds()` return empty/undefined while no api is attached. `onActivePanelChange` does **not** fire on subscribe — read the current value once if you need an initial snapshot.
- The package is React-free by contract; rendering the chrome contributed via slots is the renderer's job.

### Dependencies

- `dockview-react` (pinned `6.0.3`) — the `DockviewApi` type and panel/layout primitives `DockHost` controls. The host *component* lives in the renderer; this package only references the api type.
- `@statewalker/shared-commands` — the `Command` builder and `Commands` bus for the `dock:*` handlers.
- `@statewalker/shared-slots` — `defineSlot` / `Slots` for the three extension-point slots.
- `@statewalker/shared-registry` — `newRegistry()` disposer set used by `DockManager`.
- `@statewalker/render.core` — `SpecStore` for the close-time spec-eviction pass.
- `@statewalker/workspace.core` — `Workspace` / `getWorkspace` adapter host the fragment attaches to.

## Related

- `@statewalker/shell.view.react` — the React renderer: `<DockViewHost>`, `MainShell`, `ShellHeader`, the `"json"` panel, and the `dock:tab-icons` slot.
- `@statewalker/ui.view.react` — the substrate that renders `MainShell` under `SHELL_ROOT_VIEW_KEY` and provides the slot/adapter hooks.
- `@statewalker/render.core` — `SpecStore` and the catalogs slot the dock's panels resolve against.
- `@statewalker/workspace.core` — the workspace, commands, and slots the fragment wires into.

## License

MIT — see the monorepo root `LICENSE`.
