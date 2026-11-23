# @statewalker/settings.view.react

## What it is

A view fragment for the settings dialog. It provides `SettingsDialog`, a modal
with a tab list on the left and the active tab's content on the right, and
`SettingsButton`, which opens it. It renders the open state and tabs held by
`@statewalker/settings.core`.

## Why it exists

`@statewalker/settings.core` holds the dialog state (`Settings` adapter), the
`settings:open` command and the `settings:tabs` slot, with no React. Each tab's
content belongs to the package that contributed the tab (for example the AI
"Remote Models" tab). This package only draws the frame and looks up each
tab's component by its `viewKey`, so it does not depend on any tab.

## How to use

```sh
pnpm add @statewalker/settings.view.react
```

Peer dependencies: `react` and `react-dom` (`>=18`).

| Import | Provides |
| --- | --- |
| `@statewalker/settings.view.react` | Only the default export (the fragment init); no named exports |
| `@statewalker/settings.view.react/fragment` | Default export: `init(ctx)` returning `() => Promise<void>` |
| `@statewalker/settings.view.react/styles` | Tailwind v4 `@source` globs |

Activate it after the `settings.core` and `shell.core` logic fragments:

```ts
import "@statewalker/settings.view.react/styles";
import initSettingsView from "@statewalker/settings.view.react/fragment";

const cleanup = initSettingsView(ctx);
```

The init registers:

```
core:views
  "settings:button"  -> SettingsButton
  "settings:dialog"  -> SettingsDialog
dock:overlays
  { id: "settings:dialog", viewKey: "settings:dialog" }
```

The dialog is mounted once as an overlay. The button is registered as a view
but not placed anywhere; contribute it to `dock:header-items` (or another
slot) to show it.

## Examples

### Add a settings tab

```ts
import { settingsTabSlot } from "@statewalker/settings.core";
import { Slots } from "@statewalker/shared-slots";
import { coreViewsSlot, type ViewComponent } from "@statewalker/ui.view.react";

const slots = workspace.requireAdapter(Slots);
slots.register(coreViewsSlot, "myplugin:settings", MySettingsTab as ViewComponent);
slots.provide(settingsTabSlot, {
  id: "myplugin",
  title: "My plugin",
  viewKey: "myplugin:settings",
  order: 50,
});
```

### Open the dialog on a tab

```ts
import { OpenSettingsCommand } from "@statewalker/settings.core";

await commands.call(OpenSettingsCommand, { tabId: "myplugin" }).promise;
```

## Internals

### How the dialog picks what to show

```
Settings adapter (isOpen, activeTabId) --+
settings:tabs (sorted by order, then id) +--> SettingsDialog --> tab list
core:views                              --+                 \-> core:views[tab.viewKey]
```

- `isOpen` false: the dialog renders nothing.
- `activeTabId` does not match a tab: the first tab is shown.
- No tabs: `No settings tabs registered.`
- A tab whose `viewKey` has no component:
  `Tab "<title>" registered but no component is bound to viewKey "<viewKey>".`

`isOpen` and `activeTabId` are read with two separate `useAdapterValue`
selectors so each returns a primitive; a selector returning a new object would
re-render on every notification.

### Constraints

- Fixed size: `85vh` by `90vw`, at most `max-w-5xl`.
- Uses `Dialog` and `Button` from `@statewalker/ui.view.shadcn`.

### Dependencies

- `@statewalker/settings.core` — `Settings`, `OpenSettingsCommand`, `settingsTabSlot`.
- `@statewalker/shell.core` — `dockOverlaysSlot`.
- `@statewalker/ui.view.react` — `coreViewsSlot`, hooks, `compareByOrderAndId`.
- `@statewalker/ui.view.shadcn` — dialog and button.
- `@statewalker/shared-commands`, `@statewalker/shared-slots`, `@statewalker/shared-registry`, `@statewalker/workspace.core` — fragment wiring.
- `lucide-react` — the settings icon.

## License

MIT
