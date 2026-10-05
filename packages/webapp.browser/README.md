# @statewalker/webapp.browser

## What it is

The browser host for the web-app project nature. `hostApp` takes a web-app project, builds its `SiteHandler` with `@statewalker/webapp.core`, adds cross-origin isolation headers to every response, and mounts it behind a same-origin ServiceWorker with `HostedSiteBuilder` from `@statewalker/webrun-site-host`. The package also contains the `webapp:open` command, which hosts a project and opens it as a dock panel, and the dock-panel ids and spec shape that the `<SiteFrame>` renderer in `@statewalker/webapp.view.react` is registered against. No React.

## Why it exists

`webapp.core` produces a handler but does not know where it runs. In the browser the only way to serve a project's files and API at real URLs, so that an iframe can load them, is a ServiceWorker. This package is that binding, plus the command logic that connects it to the shell's dock. The command logic is kept free of React and takes the host function as a parameter, so it runs and is tested in Node without a ServiceWorker; the React renderer imports only the shared constants from here.

## How to use

```sh
pnpm add @statewalker/webapp.browser
```

No peer dependencies. One entry point, `@statewalker/webapp.browser`, ESM with `.d.ts`. The package ships `dist/` (built JS and types) and `src/` (TypeScript sources).

`hostApp` needs a browser with ServiceWorker support and the worker script served by the page (default `/sw-worker.js`, the `HostedSiteBuilder` default). The other exports also run in Node.

```ts
import { hostApp } from "@statewalker/webapp.browser";

const app = await hostApp(project);
iframe.src = `${app.baseUrl}~/client/index.html`;
// later
await app.stop();
```

## Examples

Options for `hostApp`:

```ts
import { dataFilesOf } from "@statewalker/webapp.core";
import { hostApp } from "@statewalker/webapp.browser";

const app = await hostApp(project, {
  siteKey: "my-app", // first URL segment after the worker scope; default: a random UUID
  serviceWorkerUrl: "/my-sw.js",
  env: { data: dataFilesOf(project) }, // context passed to the server entry
});
```

Open a project in a dock tab through the command:

```ts
import { hostApp, OpenWebAppCommand, registerOpenWebApp } from "@statewalker/webapp.browser";

// commands: a Commands instance (@statewalker/shared-commands)
// store: a SpecStore (@statewalker/render.core)
const dispose = registerOpenWebApp({ commands, store, host: hostApp });
await commands.call(OpenWebAppCommand, { project }).promise;
dispose(); // removes the listener and stops every app it hosted
```

Add isolation headers to any handler:

```ts
import { withIsolationHeaders } from "@statewalker/webapp.browser";

const isolated = withIsolationHeaders(async (req) => new Response("ok"));
```

Build the dock spec yourself:

```ts
import { makeSiteFrameSpec, webAppPanelId, webAppSpecId } from "@statewalker/webapp.browser";

const spec = makeSiteFrameSpec({ baseUrl: app.baseUrl, clientEntry: "~/client/index.html" });
webAppPanelId(project.path); // "webapp:<project path>"
webAppSpecId(project.path); // "spec:webapp:<project path>"
```

## Internals

### What `webapp:open` does

```
OpenWebAppCommand { project }
  first time for this project path:
     host(project) ──> HostedApp { baseUrl }
     store.create({ id: spec:webapp:<path>, catalogId: "webapp",
                    spec: SiteFrame { baseUrl, clientEntry: "~/<clientEntry>" },
                    meta: { persistent: true } })      (only if the spec does not exist)
  every time:
     ShowDockPanelCommand { panelId: webapp:<path>, specId }   (opens or focuses the tab)
```

Panel and spec ids use the full project path, not the folder name, so two projects with the same folder name in different places get different tabs.

The pending `host()` promise is stored before any `await`. A second dispatch for the same project that arrives while the first is still mounting reuses that promise instead of mounting a second ServiceWorker site. If mounting fails, the entry is removed so the next dispatch retries, and the command rejects with the mount error.

### Why the isolation headers

The client runs in an iframe inside a cross-origin-isolated page. Every response the worker serves therefore gets `Cross-Origin-Embedder-Policy: credentialless` and `Cross-Origin-Resource-Policy: cross-origin`. The body is streamed through unchanged and the original response is not modified.

### Why `getBaseUrl` is late-bound

The server runner imports `${baseUrl}~/<serverEntry>`, but `baseUrl` is known only after `HostedSiteBuilder.build()` returns. `hostApp` passes a closure and fills in `baseUrl` after the mount.

### API reference

- `hostApp(project, opts?)`, `HostAppOptions` (`siteKey`, `serviceWorkerUrl`, `env`), `HostedApp` (`baseUrl`, `stop()`).
- `withIsolationHeaders(handler)`, type `SiteHandler`.
- `OpenWebAppCommand` (`webapp:open`), `OpenWebAppPayload`, `registerOpenWebApp({ commands, store, host })`, `RegisterOpenWebAppOptions`, `HostAppFn`.
- `WEBAPP_DOCK_CATALOG_ID` (`"webapp"`), `webAppPanelId`, `webAppSpecId`, `makeSiteFrameSpec`, `SiteFrameParams`.

### Dependencies

- `@statewalker/webapp.core` - `buildSiteHandler`, `resolveWebAppConfig`, `appFilesOf`.
- `@statewalker/webrun-site-host` - `HostedSiteBuilder`, the ServiceWorker mount.
- `@statewalker/shell.core` - `ShowDockPanelCommand`.
- `@statewalker/render.core` - `Spec`, `SpecStore`.
- `@statewalker/shared-commands` - `Command`, `Commands`.
- `@statewalker/workspace.core` - the `Project` type.

## License

MIT
