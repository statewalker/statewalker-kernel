# @statewalker/client.core

## What it is

The platform's client API: the one module a fragment's client half imports to reach the platform. So far it holds the command bus (`commands`). The shell shares it through its import map, so every fragment gets the same instance, and installs its bindings once at boot. Private for now; no React, no DOM, no Node built-ins.

## Why it exists

ADR `2026-11-18-react-only-shell-with-shared-modules` (statewalker-root) shares React, shadcn, dockview and "the platform client API" through the shell's import map, with their versions tied to `engines.platform`. A fragment's view or handler needs the platform (to call a command, later to read settings or open a view) without bundling the platform, and without the host passing everything down as props. A module whose bindings the host installs gives it that, by bare specifier.

## How to use

In a fragment's client code (bundled with `@statewalker/client.core` external):

```ts
import { commands } from "@statewalker/client.core";

await commands.call("org.statewalker.notes/add-note", { text: "Buy milk" });
const stop = commands.observe((all) => console.log(all.map((c) => c.id)));
```

In the shell, once, at boot:

```ts
import { installClient } from "@statewalker/client.core";

const uninstall = installClient({ commands: systemCommands.bus });
```

| Export | Provides |
| --- | --- |
| `commands` | `call(id, input)`, `list()`, `observe(listener)` on the installed command bus. |
| `installClient(api)` | Install the host's bindings; returns the uninstaller. |
| `ClientApi`, `ClientCommands`, `ClientCommand` | The shapes the host installs. |
| `ClientApiError` | `not-installed` (used before the shell installed it), `already-installed` (a second host). |

## Internals

`commands` delegates each call to the bindings installed at the time of the call, so a module that imported it before the install works once the shell has booted. Before that every member throws (`call` rejects) a `ClientApiError`. One host at a time: a second `installClient` throws until the first is uninstalled.

## License

MIT. See [LICENSE](../../LICENSE).
