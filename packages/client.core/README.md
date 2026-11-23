# @statewalker/client.core

## What it is

The platform's client API: the one module a fragment's client half imports to reach the platform. So far it holds the command bus (`commands`), the workbench's dialogs and notifications (`dialogs`, `notifications`), which return the user's answer, and system.host's host services (`host`: the clipboard, the file picker, the URL state). The shell shares it through its import map, so every fragment gets the same instance, and installs its bindings once at boot. Private for now; no React, no DOM, no Node built-ins.

## Why it exists

ADR `2026-11-18-react-only-shell-with-shared-modules` (statewalker-root) shares React, shadcn, dockview and "the platform client API" through the shell's import map, with their versions tied to `engines.platform`. A fragment's view or handler needs the platform (to call a command, later to read settings or open a view) without bundling the platform, and without the host passing everything down as props. A module whose bindings the host installs gives it that, by bare specifier.

## How to use

In a fragment's client code (bundled with `@statewalker/client.core` external):

```ts
import { commands, dialogs, host, notifications } from "@statewalker/client.core";

await commands.call("org.statewalker.notes/add-note", { text: "Buy milk" });
const stop = commands.observe((all) => console.log(all.map((c) => c.id)));

// Declared in the fragment's fragment.client.jsonc on system.workbench's `dialogs` and
// `notifications` points; the answer is what the user picked.
const { action, value } = await dialogs.show("org.statewalker.notes/new-note");
const answer = await notifications.show("org.statewalker.notes/note-added", { text: value });
if (answer.action === "undo") undo();

// system.host's services: the host's own (the browser's), or a fragment's replacement.
await host.clipboard.writeText("Buy milk"); // from a click: browsers want a user gesture
const { blobs, names } = await host.files.pickFile({ accept: [".md"] });
const { path, query } = await host.urlState.read();
await host.urlState.write({ path, query: { ...query, note: "n1" } }, { replace: true });
const unfollow = host.urlState.observe((state) => console.log(state.query));
```

In the shell, once, at boot:

```ts
import { installClient } from "@statewalker/client.core";

const uninstall = installClient({
  commands: systemCommands.bus,
  dialogs: systemWorkbench.workbench.dialogs,
  notifications: systemWorkbench.workbench.notifications,
  host: systemHost.services,
});
```

| Export | Provides |
| --- | --- |
| `commands` | `call(id, input)`, `list()`, `observe(listener)` on the installed command bus. |
| `dialogs`, `notifications` | `show(id, params?)` → `Promise<{ action?, value? }>`: raise a declared dialog or notification by identity (`<fragment-id>/<id>`), its texts filled from `params` (`{name}`); `{}` when dismissed. |
| `host` | `clipboard` (`writeText`, `readText`), `files` (`pickFile(options?)` → `{ blobs, names }`), `urlState` (`read()`, `write(state, { replace? })`, `observe(listener)`): system.host's services. |
| `installClient(api)` | Install the host's bindings; returns the uninstaller. |
| `ClientApi`, `ClientCommands`, `ClientCommand`, `ClientRequests`, `ClientAnswer`, `ClientParams` | The shapes the host installs. `dialogs` and `notifications` are optional, for a host without a workbench; `host` is optional, for a host without system.host. |
| `HostServices`, `ClipboardService`, `FilePickerService`, `UrlStateService`, `UrlState`, `PickFileOptions`, `PickedFiles` | The host services' interfaces, which a fragment contributing one to `host-services` implements. `UrlState`, `PickFileOptions` and `PickedFiles` have the shapes of platform.core's `UrlState`, `PickFilePayload` and `PickFileResult`. |
| `ClientApiError` | `not-installed` (used before the shell installed it), `already-installed` (a second host). |

## Internals

`commands`, `dialogs`, `notifications` and `host` delegate each call to the bindings installed at the time of the call, so a module that imported it before the install works once the shell has booted. Before that every member throws (`call` and `show` reject) a `ClientApiError`; `show` also rejects `not-installed` when the host installed no workbench, and `host`'s members when it installed no host services. One host at a time: a second `installClient` throws until the first is uninstalled.

## License

MIT. See [LICENSE](../../LICENSE).
