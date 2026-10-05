# @statewalker/webapp.core

## What it is

The web-app project nature, with no React and no host-specific APIs. A project in a workspace (from `@statewalker/workspace.core`) is a web-app when it has a `package.json`, a client HTML entry and a server module entry. This package detects that, builds the app into a persistent module cache inside the project, rebuilds it when files change, and produces a `SiteHandler` (`(request) => Promise<Response>`) that serves the client modules and runs the server entry under `/api/*`.

## Why it exists

A web-app in the workbench is just a folder of TypeScript and HTML with npm dependencies. Running it needs dependency resolution, transpilation and a request router, and the result should survive a page reload instead of being rebuilt every time. This package does that with `@statewalker/webrun-modules` and the project build engine from `workspace.core`, and stops at the `SiteHandler`: it does not know where the handler is mounted. `@statewalker/webapp.browser` mounts it behind a ServiceWorker; other hosts can mount it elsewhere.

## How to use

```sh
pnpm add @statewalker/webapp.core
```

No peer dependencies. One entry point, `@statewalker/webapp.core`, ESM with `.d.ts`; it runs in browsers and Node. The package ships `dist/` (built JS and types) and `src/` (TypeScript sources).

A project is a web-app when these exist (paths relative to the project root):

```
package.json            dependencies pinned to exact x.y.z versions
client/index.html       client entry   (DEFAULT_CLIENT_ENTRY)
server/index.ts         server entry   (DEFAULT_SERVER_ENTRY), mounted at /api
.project/nature.webapp.json   optional: { clientEntry, serverEntry, apiMount, watchInterval }
```

```ts
import { buildSiteHandler, registerWebApp, webAppNatureOf } from "@statewalker/webapp.core";

registerWebApp(workspace); // once per workspace

const project = await workspace.getProject("my-app");
const nature = webAppNatureOf(project);
if (await nature.exists()) {
  await nature.build(); // fills <project>/.project/webapp/
  let baseUrl = "";
  const handler = await buildSiteHandler(project, { getBaseUrl: () => baseUrl });
  // mount `handler`, then set baseUrl to the URL it is served under
}
```

## Examples

Detect a web-app and read its effective configuration:

```ts
import { appFilesOf, resolveWebAppConfig } from "@statewalker/webapp.core";

const { isWebApp, config } = await resolveWebAppConfig(appFilesOf(project));
// config: { clientEntry, serverEntry, apiMount, watchInterval }
```

Rebuild on change:

```ts
const refresh = await webAppNatureOf(project).startHotRefresh();
// watches client/**, server/** and package.json every config.watchInterval ms (default 1000)
await refresh?.whenIdle();
refresh?.stop();
```

Pass a custom context to the server entry (default is `{ data: <project>/data FilesApi }`):

```ts
const handler = await buildSiteHandler(project, {
  getBaseUrl: () => baseUrl,
  env: { data: dataFilesOf(project), apiKey: "..." },
});
```

Derive the dependency lock yourself:

```ts
import { deriveLock, toExactVersion } from "@statewalker/webapp.core";

const lock = await deriveLock(appFilesOf(project)); // { react: "18.3.1", ... }
toExactVersion("^18.3.1", "react"); // throws NonExactVersionError
```

A module server over the persistent cache:

```ts
import { cacheFilesOf, newWebAppModuleServer } from "@statewalker/webapp.core";

const server = newWebAppModuleServer({ project: appFilesOf(project), cache: cacheFilesOf(project) });
const response = await server.fetch(new Request("http://host/~/client/main.ts"));
```

## Internals

### How a request is routed

```
request ──> SiteHandler
              ├── <apiMount>/*  ──> server runner: imports `${baseUrl}~/<serverEntry>` with env
              └── /*            ──> module server over <project>/.project/webapp/
                                       ~/...    project files, transpiled
                                       /deps/   npm dependencies
```

`getBaseUrl` is a function, not a string, because a host usually learns its base URL only after mounting the handler.

### The build is two builders on the project's `ProjectBuilder`

- `WebAppDeps` (`depsBuilder`) reacts only to `package.json`. It re-derives the lock and writes `lock.json` into the cache, then emits `app-deps`.
- `WebAppTranspile` (`transpileBuilder`) waits for `app-deps`, then handles changes under the client and server folders. If the cache has no `t/<target>/` yet (cold build), it primes each changed module, which pulls and transforms its whole reachable graph. Otherwise it only deletes the changed module's cache entry and lets the next request re-transform it. Removed sources also have their cache entry deleted, so a deleted module is not served from cache.

The cache lives in the project (`.project/webapp/`, written as real files: `raw/`, `t/<target>/`, `lock.json`), so a warm start reads files only, with no transform and no network.

### Why dependency versions must be exact

The module server keys its cache by the pinned version. A range (`^18.3.1`, `latest`, `workspace:*`, `file:...`) would resolve to a different id than the one requested and the module would 404. Rather than resolve ranges against a registry, `deriveLock` rejects them:

```
Dependency "react" has non-exact version "^18.3.1". webapp.core requires exact x.y.z versions in package.json (no ranges, ^, ~, dist-tags, or protocols).
```

### What breaks

- A failing transpile is logged (`transpile failed`, with the uri) and rethrown, so `build()` rejects. The update stays unhandled and is retried on the next run.
- During hot refresh, rebuild errors are caught and dropped; the only trace is the `transpile failed` log entry.
- A changed `package.json` re-writes `lock.json`, but a module server that is already running does not re-pin; the new versions take effect on the next session or host start.
- `build()` and `startHotRefresh()` do nothing on a project that is not a web-app (`startHotRefresh()` returns `undefined`). `buildSiteHandler` does not check `isWebApp`; it builds a handler with the configured or default entries either way.

### API reference

- Nature: `WebAppNature` (`exists`, `build`, `scan`, `startHotRefresh`), `HotRefreshHandle`, `registerWebApp(workspace)`, `webAppNatureOf(project)`, `buildSiteHandler(project, opts)`, `BuildSiteHandlerOptions`.
- Configuration: `resolveWebAppConfig(files)`, `WebAppConfig`, `WebAppDetection`, `DEFAULT_CLIENT_ENTRY`, `DEFAULT_SERVER_ENTRY`, `DEFAULT_API_MOUNT`, `DEFAULT_WATCH_INTERVAL_MS`, `NATURE_CONFIG_PATH`.
- Builders: `depsBuilder(ctx)`, `transpileBuilder(ctx)`, `WebAppBuilderContext`, `APP_DEPS_SIGNAL`, `APP_MODULES_SIGNAL`, `DEPS_BUILDER_ID`, `TRANSPILE_BUILDER_ID`.
- Module server: `newWebAppModuleServer(options)`, `WebAppModuleServerOptions`, `WEBAPP_CACHE_ROOT` (`.project/webapp`), `WEBAPP_DEPS_PATH` (`/deps/`).
- Lock: `deriveLock(appFiles)`, `toExactVersion(range, dependency?)`, `NonExactVersionError`.
- Files: `PrefixFilesApi` (a `FilesApi` rooted at a path prefix of another one), `appFilesOf`, `cacheFilesOf`, `dataFilesOf`, `systemFolderOf`.

### Dependencies

- `@statewalker/workspace.core` - `Project`, `ProjectBuilder`, `ProjectWatcher`, the adapter registry.
- `@statewalker/webrun-modules` - the module server (dependency fetch, transpile, cache layout).
- `@statewalker/webrun-site-builder` - `SiteBuilder` that routes requests to endpoints.
- `@statewalker/webrun-site-host` - `newServerRunner`, which runs the server entry.
- `@statewalker/webrun-files` - the `FilesApi` contract.

## License

MIT
