# @statewalker/settings.core

## What it is

The React-free logic fragment for the workbench settings dialog. It owns the
dialog's open / active-tab state (`Settings` workspace adapter), the
`settings:open` / `settings:close` commands that mutate it, and the
`settings:tabs` extension-point slot that other fragments contribute tabs
to. It contains no React — the dialog is rendered by
`@statewalker/settings.view.react`.

## Why it exists

The settings dialog is a host-wide overlay that any fragment may want to
open (e.g. an AI-providers fragment opening straight to its tab) and any
fragment may want to extend with its own tab. Per ADR-0002, the logic —
state, commands, the contribution slot — is isolated from the rendering so
that a logic fragment can register a settings tab without importing React.
Tabs are contributed by reference (`viewKey`), resolved against
`ViewRegistry` at render time, so the core never sees the actual React
component.

## How to use

```sh
pnpm add @statewalker/settings.core
```

Activate the default export (also at `./fragment`) **after** the substrate
fragments and **before** any fragment that contributes to `settings:tabs`:

```ts
import initSettings from "@statewalker/settings.core/fragment";

const cleanup = initSettings(ctx); // registers Settings adapter + command handlers
// ... later
await cleanup();
```

Open the dialog from anywhere via the command:

```ts
import { OpenSettingsCommand, CloseSettingsCommand } from "@statewalker/settings.core";
import { Commands } from "@statewalker/shared-commands";

const commands = workspace.requireAdapter(Commands);
await commands.call(OpenSettingsCommand, { tabId: "providers" }); // tabId optional
await commands.call(CloseSettingsCommand);
```

## Examples

### Contributing a settings tab

A logic fragment contributes a `SettingsTab` to the slot; its paired
renderer fragment registers the actual component into `ViewRegistry` under
`viewKey`:

```ts
import { settingsTabSlot, type SettingsTab } from "@statewalker/settings.core";
import { Slots } from "@statewalker/shared-slots";

const slots = workspace.requireAdapter(Slots);
const tab: SettingsTab = {
  id: "providers",       // becomes the activeTabId / hash anchor
  title: "Providers",    // sidebar label
  viewKey: "settings:providers", // resolved via ViewRegistry at render time
  order: 10,             // lower appears first; default 100
};
const stop = slots.provide(settingsTabSlot, tab);
```

### Reading dialog state in a (logic) consumer

```ts
import { Settings } from "@statewalker/settings.core";

const settings = workspace.requireAdapter(Settings);
settings.isOpen;        // boolean
settings.activeTabId;   // string | null
settings.setActiveTab("keyboard"); // React-side action; notifies subscribers
```

`Settings` extends `BaseClass`, so React consumers subscribe via
`useSyncExternalStore` on `BaseClass.onUpdate`. The open/close transitions
go through `_setOpen`, which is manager-only — fire the commands instead.

## Internals

### Architectural decisions

- **State / commands / slot, no React.** The `.core` half of the ADR-0002
  split. Tabs are identified by `viewKey` (slot pattern C), so contributors
  never import React; the renderer binds the component into `ViewRegistry`.
- **One-shot manager.** `SettingsManager` registers the `settings:open` /
  `settings:close` handlers at boot and survives `onLoad` / `onUnload`
  cycles, because dialog open-state is local UI and does not depend on
  workspace lifecycle.
- **Silent commands.** Both commands are `Command.silent`, so consumers fire
  them without importing the `Settings` adapter directly.

### Constraints

- The `Settings` adapter holds only `isOpen` + `activeTabId`. There is no
  persistence of which tab was last open beyond the in-memory adapter.
- `_setOpen` is intended for the manager (and the dialog's `onOpenChange`);
  application code should use the commands.

### Dependencies

- `@statewalker/shared-baseclass` — `BaseClass` observable for the `Settings`
  adapter.
- `@statewalker/shared-commands` — `Command` builder + `Commands` adapter.
- `@statewalker/shared-registry` — LIFO cleanup in init / manager.
- `@statewalker/shared-slots` — the `settings:tabs` slot.
- `@statewalker/workspace.core` — `getWorkspace` + adapter wiring.

## Related

- `@statewalker/settings.view.react` —
  the renderer fragment (settings button + dialog) that consumes this
  fragment's state, commands, and `settings:tabs` slot.

## License

MIT — see the monorepo root `LICENSE`.
