# @statewalker/settings.core

## What it is

The React-free logic fragment of the settings dialog. It keeps the dialog's
open state and active tab in the `Settings` workspace adapter, handles the
`settings:open` / `settings:close` commands, and declares the `settings:tabs`
slot that other fragments contribute tabs to.

## Why it exists

Any fragment may need to open the settings dialog (for example straight to its
own tab) or add a tab to it. With this package a fragment does both through a
command and a slot value, without importing React. A tab names its content by a
`viewKey` string; the renderer, `@statewalker/settings.view.react`, maps the key
to a component and draws the dialog.

## How to use

```sh
pnpm add @statewalker/settings.core
```

No peer dependencies. No DOM or Node APIs.

| Import | Gives |
| --- | --- |
| `@statewalker/settings.core` | `Settings`, `OpenSettingsCommand`, `CloseSettingsCommand`, `settingsTabSlot`, types (no default export) |
| `@statewalker/settings.core/fragment` | default export `initSettings(ctx)`: sets the `Settings` adapter and registers the command handlers; returns `cleanup` |

Boot it after the workspace substrate and before fragments that contribute tabs:

```ts
import initSettings from "@statewalker/settings.core/fragment";

const cleanup = initSettings(ctx);
```

## Examples

Open or close the dialog:

```ts
import { CloseSettingsCommand, OpenSettingsCommand } from "@statewalker/settings.core";
import { Commands } from "@statewalker/shared-commands";

const commands = workspace.requireAdapter(Commands);
await commands.call(OpenSettingsCommand, { tabId: "providers" }).promise; // tabId is optional
await commands.call(CloseSettingsCommand, undefined).promise;
```

Contribute a tab:

```ts
import { settingsTabSlot, type SettingsTab } from "@statewalker/settings.core";
import { Slots } from "@statewalker/shared-slots";

const tab: SettingsTab = {
  id: "providers", // becomes activeTabId
  title: "Providers", // sidebar label
  viewKey: "settings:providers", // the renderer maps it to a component
  order: 10, // lower comes first; default 100
};
const remove = workspace.requireAdapter(Slots).provide(settingsTabSlot, tab);
```

Follow the dialog state:

```ts
import { Settings } from "@statewalker/settings.core";

const settings = workspace.requireAdapter(Settings);
const off = settings.onUpdate(() => console.log(settings.isOpen, settings.activeTabId));
settings.setActiveTab("keyboard");
```

## Internals

### Why open and close go through commands

`Settings` extends `BaseClass` (`@statewalker/shared-baseclass`), so
`onUpdate(cb)` reports every change. Its `_setOpen(open, tabId?)` is meant for
the command handlers only; other code fires `settings:open` / `settings:close`
and does not need the adapter. `setActiveTab` is public because the dialog
switches tabs itself. `settings:open` without `tabId` keeps the current
`activeTabId` (which is `null` until a tab is chosen).

### Why the handlers live for the whole session

The dialog state is local UI and does not depend on which workspace is loaded.
The internal `SettingsManager` registers both handlers at boot and keeps them
across workspace `onLoad` / `onUnload` until `cleanup` runs.

### What breaks

- Both commands are `Command.silent`. If `initSettings` was not booted, the
  promise returned by `commands.call(...)` never settles; nothing is logged.
- State is in memory only. A reload opens with the dialog closed and no active tab.

### Dependencies

- `@statewalker/shared-baseclass` — change notifications for `Settings`.
- `@statewalker/shared-commands` — the two commands.
- `@statewalker/shared-registry` — `cleanup` of the fragment and manager.
- `@statewalker/shared-slots` — the `settings:tabs` slot.
- `@statewalker/workspace.core` — `getWorkspace` and adapter registration.

## License

MIT
