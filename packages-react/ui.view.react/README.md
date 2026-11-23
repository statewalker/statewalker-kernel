# @statewalker/ui.view.react

## What it is

The React base of the shell. Its fragment init mounts `<AppRoot/>` into
`#app`. It declares the `core:views` keyed slot, where view packages register
React components under string keys, and provides the hooks every view package
uses to read the `Workspace`: `useAppWorkspace`, `useAdapter`,
`useAdapterValue`, `useSlot`, `useKeyedSlot`. Its stylesheet defines the theme
(CSS variables and the `.dark` variant).

## Why it exists

The shell is a set of fragments connected through a `Workspace` (commands,
slots, adapters). They need one way to enter React and one way to read
workspace state inside a component. This package is that single place: it
mounts the tree once, and the `core:views` slot lets packages refer to each
other's components by key instead of importing them. It holds no application
UI except the folder-picker screen shown before a workspace is open.

## How to use

```sh
pnpm add @statewalker/ui.view.react
```

Peer dependencies: `react` and `react-dom` (`>=18`).

| Import | Provides |
| --- | --- |
| `@statewalker/ui.view.react` | Hooks, `AppWorkspaceProvider`, `DirectoryPickerEmptyState`, `coreViewsSlot`, `SHELL_ROOT_VIEW_KEY`, `compareByOrderAndId`, types; default export is the fragment init |
| `@statewalker/ui.view.react/fragment` | Default export: `init(ctx)` that mounts `<AppRoot/>` into `#app` and returns an unmount function |
| `@statewalker/ui.view.react/styles` | Theme CSS variables, `.dark` variant, Tailwind v4 `@source` globs |

Browser only (uses `document` and `react-dom/client`).

```ts
import "@statewalker/ui.view.react/styles";
import initUi from "@statewalker/ui.view.react/fragment";

const unmount = initUi(ctx); // ctx carries the Workspace
```

The init reads the `Workspace` from `ctx` and a React Query `QueryClient` from
`ctx["core-views:query-client"]`. If no client is there it creates one
(`retry: false`, `refetchOnWindowFocus: false`) and stores it under that key.

## Examples

### Register a component under a view key

```ts
import { Slots } from "@statewalker/shared-slots";
import { coreViewsSlot, type ViewComponent } from "@statewalker/ui.view.react";

const slots = workspace.requireAdapter(Slots);
const unregister = slots.register(coreViewsSlot, "myfragment:panel", MyPanel as ViewComponent);
```

Other code refers to `"myfragment:panel"` as data and resolves it at render
time with `useKeyedSlot(slots, coreViewsSlot).get("myfragment:panel")`. Key
convention: `<owning-fragment>:<purpose>`.

### Read an adapter reactively

```tsx
import { useAdapterValue } from "@statewalker/ui.view.react";
import { WorkspaceShellAdapter } from "@statewalker/workspace.browser";

function Status() {
  const status = useAdapterValue(WorkspaceShellAdapter, (a) => a.getState().status);
  return <span>{status}</span>;
}
```

`useAdapterValue(Ctor, selector)` subscribes through the adapter's
`onUpdate(cb)` and re-renders on each notification. `useAdapter(Ctor)` is the
non-reactive form (`useAppWorkspace().requireAdapter(Ctor)`).

### Subscribe to slots

```tsx
import { Slots } from "@statewalker/shared-slots";
import { compareByOrderAndId, coreViewsSlot, useAdapter, useKeyedSlot, useSlot } from "@statewalker/ui.view.react";

function Toolbar() {
  const slots = useAdapter(Slots);
  const views = useKeyedSlot(slots, coreViewsSlot);
  const items = [...useSlot(slots, toolbarItemsSlot)].sort(compareByOrderAndId);
  return (
    <>
      {items.map((item) => {
        const View = views.get(item.viewKey);
        return View ? <View key={item.id} /> : null;
      })}
    </>
  );
}
```

`useSlot` returns a reference-stable readonly array. `useKeyedSlot` returns a
`KeyedSlotView` with `get(id)` and a reference-stable `entries` map.
`compareByOrderAndId` sorts by `order` (default `100`), then by `id`.

### Use the workspace outside `<AppRoot>`

```tsx
import { AppWorkspaceProvider } from "@statewalker/ui.view.react";

<AppWorkspaceProvider workspace={workspace}>
  <ComponentUnderTest />
</AppWorkspaceProvider>;
```

## Internals

### What `<AppRoot/>` renders

```
<StrictMode>
  <AppWorkspaceProvider workspace>
    <QueryClientProvider client>
      <App/>
        WorkspaceShellAdapter status != "ready"  -> <DirectoryPickerEmptyState/>
        status == "ready"                         -> core:views["shell:root"] (or nothing)
```

`DirectoryPickerEmptyState` covers the four non-ready statuses: `loading`
(disabled "Open folder"), `unsupported` (explanation, no picker),
`empty` (folder picker, fires `ChangeWorkspaceCommand`), `needs-permission`
(reconnect button plus "pick a different folder"). `MainShell` from
`@statewalker/shell.view.react` is registered under `shell:root`
(`SHELL_ROOT_VIEW_KEY`), so this package never imports the shell.

### Failure modes

- No `#app` element: the init does nothing and returns a no-op cleanup. No
  error is thrown.
- `useAppWorkspace()` outside the provider throws
  `useAppWorkspace must be used inside <AppWorkspaceProvider>.`
- `useAdapter` for an adapter that is not installed throws from the
  workspace's `requireAdapter` (`No adapter registered for ...`).
- The workspace is `ready` but nothing is registered under `shell:root`: the
  page is blank.

### Selectors must return stable values

`useAdapterValue` uses `useSyncExternalStore`, which compares snapshots with
`Object.is`. A selector that builds a new array or object on each call
re-renders on every notification. Return primitives or references the adapter
keeps.

### Dependencies

- `@statewalker/shared-slots` — `defineKeyedSlot` and `Slots` for `core:views` and the slot hooks.
- `@statewalker/workspace.core` — the `Workspace` type and `getWorkspace(ctx)`.
- `@statewalker/workspace.browser` — `WorkspaceShellAdapter` and the
  change/reconnect commands used by the folder-picker screen.
- `@statewalker/shared-commands` — `Commands` adapter for those commands.
- `@statewalker/ui.view.shadcn` — `Button` and `Card` for the folder-picker screen.
- `@tanstack/react-query` — the app-wide `QueryClient`.
- `lucide-react` — the folder icon.
- `@statewalker/shared-baseclass`, `@statewalker/shared-registry` — declared;
  `useAdapterValue` uses the `onUpdate` shape structurally instead of importing `BaseClass`.

## License

MIT
