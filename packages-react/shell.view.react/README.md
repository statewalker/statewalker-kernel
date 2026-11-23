# @statewalker/shell.view.react

## What it is

The React application shell. `MainShell` lays out a header, left and right
side panels, overlays, and a central [dockview](https://dockview.dev/) area
with tabs. `DockViewHost` mounts `dockview-react` and binds its API to the
`DockHost` adapter from `@statewalker/shell.core`, so `dock:*` commands open,
focus and close real tabs. Every tab renders through a single `json` panel
kind, which looks up a json-render spec and catalog and renders it with
`SpecRenderer`.

## Why it exists

`@statewalker/shell.core` defines the dock commands (`dock:show-panel`,
`dock:close-panel`, `dock:focus-panel`), the slots that describe the shell
chrome (`dock:header-items`, `dock:side-panels`, `dock:overlays`) and the
`DockHost` adapter, all without React. Something has to resolve the
contributions' `viewKey`s to components, own the dockview instance, and draw
the frame. This package does that, and registers `MainShell` under
`shell:root` so `@statewalker/ui.view.react` renders it without importing it.

## How to use

```sh
pnpm add @statewalker/shell.view.react
```

Peer dependencies: `react` and `react-dom` (`>=18`).

| Import | Provides |
| --- | --- |
| `@statewalker/shell.view.react` | `MainShell`, `DockViewHost`, `dockTabIconSlot`, `DockTabIcon`; default export is the fragment init |
| `@statewalker/shell.view.react/fragment` | Default export: `init(ctx)` registering `MainShell` into `core:views` under `shell:root` |
| `@statewalker/shell.view.react/styles` | Tailwind v4 `@source` globs |

The built JS imports `dockview-react/dist/styles/dockview.css` and a local CSS
file, so the host bundler must handle CSS imports. Browser only.

```ts
import "@statewalker/shell.view.react/styles";
import initShellView from "@statewalker/shell.view.react/fragment";

const cleanup = initShellView(ctx); // after the shell.core logic fragment
```

Once the workspace is `ready`, `<App/>` from `@statewalker/ui.view.react`
renders `MainShell`.

## Examples

### Add an icon to tabs whose panel id has a prefix

```tsx
import { Slots } from "@statewalker/shared-slots";
import { dockTabIconSlot } from "@statewalker/shell.view.react";
import { FileText } from "lucide-react";

const slots = workspace.requireAdapter(Slots);
const remove = slots.provide(dockTabIconSlot, { panelIdPrefix: "file:", Icon: FileText });
```

The tab uses the entry with the longest `panelIdPrefix` that the panel id
starts with, so `"chat:agent:"` wins over `"chat:"`. `Icon` must accept a
`className` prop.

### Render the dock area alone (for example in a test)

```tsx
import { DockViewHost } from "@statewalker/shell.view.react";

<DockViewHost workspace={workspace} />;
```

`DockViewHost` takes the `Workspace` as a prop. The panels inside read it from
React context (`useAppWorkspace()`), so an `<AppWorkspaceProvider>` must still
be an ancestor.

## Internals

### Layout

```
MainShell
+------------------------------------------------------------+
| ShellHeader: dock:header-items "leading" ...    "trailing" |
+-----------+-------------------------------+----------------+
| side      | DockViewHost                  | side           |
| panels    |  tabs (LineTab)               | panels         |
| "left"    |  each tab = JsonPanel         | "right"        |
+-----------+-------------------------------+----------------+
dock:overlays mounted next to the layout (dialogs etc.)
```

Every slot entry carries a `viewKey`; the component is looked up in
`core:views` at render time. An unknown key renders nothing.

### One panel kind: `json`

`DockViewHost` registers exactly `{ json: JsonPanel }`. A tab's content comes
from a `SpecRecord` in `SpecStore` (by `specId`) and the registry stored under
its `catalogId` in the `json:catalogs` slot. New kinds of tabs are added with
new specs and catalogs, not new dockview components. `JsonPanel` re-renders
when its spec changes.

What you see when something is missing:

- `Spec <specId> is missing.` with a "Close panel" button — the tab was
  restored from a saved layout but no spec was created for it.
- `Catalog <catalogId> is not registered.` — the view fragment that owns the
  catalog was not activated.

`JsonPanel` renders `SpecRenderer` without `handlers`. Actions dispatched by a
spec in a dock tab therefore log `No handler registered for action: ...` and
do nothing; components that need to act should call commands themselves.

### Closing goes through the command bus

The tab close button and the placeholders' "Close panel" call
`ClosePanelCommand` (`dock:close-panel`) instead of dockview's
`api.close()`, so the logic side can drop the panel's spec.

### API binding

`DockViewHost` calls `DockHost.setApi(api)` in dockview's `onReady` and
`DockHost.detach()` on unmount. `dock:show-panel` calls made before the shell
mounts are handled by `DockHost` once the API arrives.

### Dependencies

- `dockview-react` — the dock.
- `@statewalker/shell.core` — commands, chrome slots, `DockHost`.
- `@statewalker/render.core`, `@statewalker/render.view.react` — `SpecStore`, `json:catalogs`, `SpecRenderer`.
- `@statewalker/ui.view.react` — `core:views`, `shell:root`, hooks.
- `@statewalker/ui.view.shadcn` — resizable panels, `cn()`.
- `@statewalker/shared-commands`, `@statewalker/shared-slots`, `@statewalker/shared-registry`, `@statewalker/workspace.core` — fragment wiring.
- `lucide-react` — the tab close icon.

`dock:tab-icons` lives here, not in `shell.core`, because its values are React
components.

## License

MIT
