# @statewalker/shell.core

## What it is

The React-free logic of the application shell (the "dock"). It declares the
`dock:*` commands (`show-panel`, `close-panel`, `focus-panel`,
`set-panel-title`), the slots that describe the shell's chrome
(`dock:side-panels`, `dock:header-items`, `dock:overlays`), and the `DockHost`
workspace adapter: a command-driven controller over a dockview `DockviewApi`.
Its fragment handles the four `dock:*` commands.

## Why it exists

Fragments need to open panels, retitle tabs, and add side panels or header
items, without importing React or knowing DockView. With this package they call
commands and contribute slot values; only `DockHost` touches the DockView api.
The renderer, `@statewalker/shell.view.react`, mounts DockView and draws the
chrome contributed through the slots.

## How to use

```sh
pnpm add @statewalker/shell.core
```

No peer dependencies. `dockview-core` is a dependency (for the `DockviewApi`
type). The fragment needs a `Workspace` (`@statewalker/workspace.core`) with
`SpecStore` from `@statewalker/render.core`.

| Import | Gives |
| --- | --- |
| `@statewalker/shell.core` | `DockHost`, the `dock:*` commands, the three slots, types (no default export) |
| `@statewalker/shell.core/fragment` | default export `initDock(ctx)`: registers the `dock:*` handlers; returns `cleanup` |

```ts
import initDock from "@statewalker/shell.core/fragment";

const cleanup = initDock(ctx);
```

## Examples

Open, retitle, focus and close a panel:

```ts
import { Commands } from "@statewalker/shared-commands";
import {
  ClosePanelCommand,
  FocusPanelCommand,
  SetPanelTitleCommand,
  ShowDockPanelCommand,
} from "@statewalker/shell.core";

const commands = workspace.requireAdapter(Commands);

await commands.call(ShowDockPanelCommand, {
  panelId: "preview",
  specId: "spec-preview", // a spec in SpecStore; the panel renders it
  position: "right", // "left" | "right" | "top" | "bottom" | "within"
  referencePanelId: "editor", // dock relative to this panel if it is open
  title: "Preview",
}).promise;
await commands.call(SetPanelTitleCommand, { panelId: "preview", title: "Preview 2" }).promise;
await commands.call(FocusPanelCommand, { panelId: "preview" }).promise;
await commands.call(ClosePanelCommand, { panelId: "preview" }).promise;
```

Contribute shell chrome (`viewKey` is a string the renderer maps to a component):

```ts
import { Slots } from "@statewalker/shared-slots";
import { dockHeaderItemsSlot, dockOverlaysSlot, dockSidePanelsSlot } from "@statewalker/shell.core";

const slots = workspace.requireAdapter(Slots);
slots.provide(dockSidePanelsSlot, {
  id: "explorer",
  side: "left",
  order: 10, // lower is closer to the screen edge
  viewKey: "explorer:tree",
  defaultSize: "20%",
  minSize: "180px",
});
slots.provide(dockHeaderItemsSlot, { id: "workspace-switcher", slot: "leading", order: 0, viewKey: "workspace:switcher" });
slots.provide(dockOverlaysSlot, { id: "settings-dialog", viewKey: "settings:dialog" });
```

Watch dock state:

```ts
import { DockHost } from "@statewalker/shell.core";

const dock = workspace.requireAdapter(DockHost);
const offActive = dock.onActivePanelChange((id) => console.log("active:", id));
const offLayout = dock.onLayoutChange(() => console.log(dock.getPanelIds()));
```

## Internals

### Why panel opens are queued

The `dock:*` handlers are registered at boot, but DockView mounts later inside
the React tree and hands its api to `DockHost.setApi`. `showOrFocus` calls made
before that are queued; `setApi` opens them in order and resolves their
promises. So a `dock:show-panel` issued at boot resolves only once the panel is
actually open. `closePanel` before mount removes the panel from the queue;
`focusPanel` and `setPanelTitle` before mount do nothing.

### Every panel is a json-render spec

The `show-panel` payload has no DockView `component` field. Every panel is added
with component `"json"` and `params: { specId }`; the renderer looks the spec up
in `SpecStore`. A new kind of panel is a new spec and catalog, not a new
DockView component.

### How a panel is placed

- An open `panelId` is focused, not duplicated (unless `activate: false`). This
  is why callers build panel ids from the content, for example the file URI.
- With `referencePanelId` naming an open panel, the panel docks relative to it,
  in `position` (default `"within"`: a new tab in that panel's group). If the
  reference is not open, it is ignored.
- `title` defaults to `panelId`.

### When a spec is deleted

`dock:close-panel` deletes the closed panel's spec from `SpecStore` when no other
open panel uses the same `specId` and the spec's `meta.persistent` is not
`true`. Persistent specs survive close and reopen.

### How the layout is saved and restored

`DockHost` saves `api.toJSON()` into the `LayoutStore` adapter
(`@statewalker/render.core`) once per microtask after layout changes, and
re-applies the saved layout on `workspace.onLoad`. On `detach` it keeps an
in-memory snapshot, which the next `setApi` applies first, so a React StrictMode
or HMR remount does not lose panels added since the last save.

### What breaks

- `DockHost` finds `LayoutStore` with `getAdapter`, which does not create it. If
  no fragment has resolved `LayoutStore` with `requireAdapter`, the layout is
  neither saved nor restored, without any message.
- A layout that DockView cannot apply logs
  `[chat-mini:dock] failed to restore in-memory layout` and falls back to the
  saved layout. Save errors log `[chat-mini:dock] failed to persist layout`.
- The commands are `Command.silent`: without `initDock`, their promises never
  settle.
- `onActivePanelChange` is not called on subscribe; read `getActivePanelId()`
  first if you need the current value. Before mount, `getPanelIds()` is empty.

### Tracing command and slot traffic

Set `localStorage["chat-mini:bus-trace"] = "1"` and reload: the fragment wraps
`Commands.listen` and `Slots.provide` and logs registrations and claims with
`console.debug`. When the key is absent, nothing is wrapped.

### Dependencies

- `dockview-core` — the `DockviewApi` type `DockHost` drives.
- `@statewalker/shared-commands` — the `dock:*` commands.
- `@statewalker/shared-slots` — the chrome slots.
- `@statewalker/shared-registry` — `cleanup` of the handlers.
- `@statewalker/render.core` — `SpecStore` (eviction on close) and `LayoutStore`.
- `@statewalker/workspace.core` — `getWorkspace` and `onLoad`.

## License

MIT
