# system.host

## What it is

The core fragment through which fragments reach the host: the clipboard, the file picker and the URL state. It opens one extension point in its client aspect, `host-services`, and answers each call with the service in effect: the host's own (in a browser, platform.browser's `createBrowserHostServices()`), or one a fragment contributes instead, for as long as that fragment lives. Fragments reach it through the client API, `host` from `@statewalker/client.core`. It is a private workspace package, `@statewalker/system.host`, with no React, no DOM and no Node built-ins.

## Why it exists

ADR `2026-11-20-kernel-and-core-fragments` (statewalker-root) gives `host-services` to `system.host`, and spec statewalker/statewalker-root#215 lists what it covers: clipboard, file pickers, URL state. Before it, these were `platform:*` commands of `@statewalker/platform.core` registered on a workspace's bus by `@statewalker/platform.browser`: one implementation per page, which nothing could replace or take away. Here the host's implementation is the default, a fragment can replace one kind of service (a desktop host's clipboard, a router keeping the URL in a path), and the kernel takes the replacement away with its fragment, so the default comes back.

## How to use

```ts
import {
  createSystemHost,
  HOST_SERVICE_KINDS,
  HostServiceError,
  hostServiceSchema,
  SYSTEM_HOST_ID,
  systemHostArchive,
} from "@statewalker/system.host";
```

| Export | Provides |
| --- | --- |
| `systemHostArchive`, `SYSTEM_HOST_ID` | The fragment's files (`fragment.jsonc`, `fragment.client.jsonc`), for `createKernel({ core })`. |
| `createSystemHost({ defaults? })` → `{ services, provider, activate }` | The services fragments reach (what the shell installs as the client API's `host`), the fragment providing each kind (`undefined` for the host's own), and the body of the fragment's client activator. `defaults` are the host's own services. |
| `HostServiceError` | `unavailable` (neither the host nor a fragment provides the kind), `invalid-service` (the service in effect lacks the method called); `service` names the kind, `fragment` the contributor. A service's own failures pass through unchanged. |
| `HOST_SERVICES_POINT`, `HOST_SERVICE_KINDS`, `HostServiceKind`, `hostServiceSchema` | The point's short id, the kinds (`clipboard`, `files`, `url-state`) and its schema (JSON Schema 2020-12). |

The services' interfaces (`HostServices`, `ClipboardService`, `FilePickerService`, `UrlStateService`) are the client API's, in `@statewalker/client.core`.

## Examples

The shell runs it with the browser's services as defaults, and installs its services as the client API's `host`:

```ts
const host = createSystemHost({ defaults: createBrowserHostServices() });
const kernel = createKernel({
  platform,
  core: [systemCommandsArchive, systemWorkbenchArchive, systemHostArchive],
  resolvers: { module: (ref, { contributor }) => importExport(contributor, ref) },
  activators: {
    client: (fragment, context) =>
      fragment.id === SYSTEM_HOST_ID ? host.activate(context) : activateClient(fragment),
  },
});
installClient({ commands: commands.bus, host: host.services });
```

A fragment's view copies a note, on the user's click:

```ts
import { host } from "@statewalker/client.core";

await host.clipboard.writeText(note);
```

A fragment replaces the URL state with its own, in its `fragment.client.jsonc` (no `requires` on system.host):

```jsonc
{
  "extensions": [
    {
      "point": "host-services",
      "data": { "service": "url-state" },
      "reference": { "module": "./index.js", "export": "pathRouter" }
    }
  ]
}
```

```ts
import type { UrlStateService } from "@statewalker/client.core";

export const pathRouter: UrlStateService = {
  read: async () => ({ path: location.pathname, query: Object.fromEntries(new URLSearchParams(location.search)) }),
  async write(state, options) { /* history.pushState / replaceState */ },
  observe(listener) { /* popstate */ return () => {}; },
};
```

## Internals

### The `host-services` point

An extension's data is `{ service }`, one of `clipboard`, `files` and `url-state`; anything else is refused by the kernel with a reason in `system:extensions:refused:client`. The service is the extension's lazy reference, a client module export implementing the kind's interface; an extension without a reference provides nothing. For each kind the first live extension read is in effect, and the next one takes over when it leaves; with none, the host's default answers. The fragment follows the point through its activation context, so a contributed service lives exactly while its fragment is resolved: disabling the fragment brings the default back, enabling it again brings the fragment's back.

### Calls

Every call goes to the service in effect at the time of the call: a contributed service is resolved through the kernel (lazily, on first use: a fragment's code loads only when its service is called), then its method is called. A call pending when the contributor leaves rejects as its reference does (the kernel's `ExtensionUnavailable`). `urlState.observe` listeners stay subscribed across changes of provider: system.host follows the service in effect while anyone observes, and moves to the next one when the provider changes, so a listener hears the new provider's changes and no longer the old one's.

### Security

The clipboard and the file picker are user-gesture-sensitive: browsers grant them in a secure context, and mostly only right after a user action (a click), so fragments call them from event handlers, and the browser asks the user for clipboard reading. The client API is for the client code of fragments the user installed; agents, peers and sandboxes have no client API and never reach host services directly. Should an agent need one, it goes through a command (declared on system.commands' bus, with its exposure) and so through system.security's gate, under the user's Allow/Ask/Block policy. A fragment contributing a host service sees what other fragments pass through it (what is copied, the files picked, the URL), so the consent screen should show a `host-services` contribution like a permission (statewalker/statewalker-root#215's install consent).

### Dependencies

- `@statewalker/kernel.core`: the activation context, the archive type.
- `@statewalker/client.core`: the services' interfaces (types only).

## License

MIT. See [LICENSE](../../LICENSE).
