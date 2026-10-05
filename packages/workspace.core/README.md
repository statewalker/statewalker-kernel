# @statewalker/workspace.core

## What it is

The workspace model of the StateWalker workbench, with no React and no browser APIs. A `Workspace` owns one `FilesApi` (the folder the user opened) and a class-keyed set of adapters. Top-level directories are `Project`s and files are `Resource`s; all three are adapter hosts. On top of that the package provides the project build engine (`ProjectBuilder`), a polling `ProjectWatcher`, project "natures", the `workspace:change` and `files:*` commands, and two logic-fragment inits that register their handlers.

## Why it exists

Every workbench feature (explorer, settings, AI sessions, web-apps, version control) needs the same things: the opened folder, a place to keep secrets and settings, a way to treat a top-level directory as a project, and a way to attach behaviour to a file or project without the core knowing about it. This package is that shared substrate. It knows nothing about how a folder is picked or displayed, so the same model runs in a browser (with `@statewalker/workspace.browser`), in Node, and in tests over an in-memory `FilesApi`.

## How to use

```sh
pnpm add @statewalker/workspace.core
```

No peer dependencies. You also need a `FilesApi` implementation, for example `@statewalker/webrun-files-mem`, `@statewalker/webrun-files-node` or `@statewalker/webrun-files-browser`.

| Import | Contents |
| --- | --- |
| `@statewalker/workspace.core` | The whole API. Default export: the same init as `./fragment`. |
| `@statewalker/workspace.core/fragment` | Default export `init(ctx)`: registers the `workspace:change` handler. Returns a cleanup function. |
| `@statewalker/workspace.core/files-fragment` | Default export `initWorkspaceFiles(ctx)`: registers the `files:*` handlers against `workspace.files`. Returns a cleanup function. |

All entry points are ESM with `.d.ts` and run in browsers and Node. The package ships `dist/` (built JS and types) and `src/` (TypeScript sources). Both fragment inits read the workspace with `getWorkspace(ctx)` and need a `Commands` adapter (from `@statewalker/shared-commands`) on it.

The happy path:

```ts
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { initWorkspace, Workspace } from "@statewalker/workspace.core";

const workspace = initWorkspace({ workspace: new Workspace(), filesApi: new MemFilesApi() });
await workspace.open();
const project = await workspace.getProject("notes", true);
```

## Examples

Secrets and settings (installed by `initWorkspace` as files under `.settings/`):

```ts
import { Secrets, Settings } from "@statewalker/workspace.core";

await workspace.requireAdapter(Secrets).set("openai", { apiKey: "..." });
await workspace.requireAdapter(Settings).set("theme", "dark");
const theme = await workspace.requireAdapter(Settings).get<string>("theme");
```

Reading and writing a file through resource adapters:

```ts
import { JsonAdapter, TextAdapter } from "@statewalker/workspace.core";

const res = await workspace.getResource("/notes/meta.json", true);
await res?.requireAdapter(JsonAdapter).setJson({ title: "Notes" });
const text = await res?.requireAdapter(TextAdapter).getText();
```

A project-level adapter, registered for every project:

```ts
import { ProjectAdapter } from "@statewalker/workspace.core";

class WordCount extends ProjectAdapter {
  async count(path: string) {
    const res = await this.project.getProjectResource(path);
    return res ? (await res.requireAdapter(TextAdapter).getText()).split(/\s+/).length : 0;
  }
}
workspace.adaptersRegistry.register("project", WordCount, (p) => new WordCount(p));
const n = await project?.requireAdapter(WordCount).count("README.md");
```

Registering a builder and running a build:

```ts
import { ProjectBuilder, SOURCES_SIGNAL } from "@statewalker/workspace.core";

const builder = project.requireAdapter(ProjectBuilder);
builder.registerBuilder({
  id: "Counter",
  inputs: [SOURCES_SIGNAL],
  outputs: [],
  async *handler(project) {
    for await (const u of builder.readUpdates({ signal: SOURCES_SIGNAL, cell: "Counter" })) {
      await u.handled();
    }
    return true;
  },
});
for await (const _ of builder.run()) {
}
```

Watching a project for changes:

```ts
import { ProjectWatcher } from "@statewalker/workspace.core";

const watcher = project.requireAdapter(ProjectWatcher);
watcher.watch("src/**", ({ changed, removed }) => console.log(changed, removed));
watcher.start(2000); // poll every 2 s; watcher.stop() to end
```

Switching the folder through the command (handler from `./fragment`):

```ts
import { Commands } from "@statewalker/shared-commands";
import { ChangeWorkspaceCommand, getWorkspace } from "@statewalker/workspace.core";

const commands = getWorkspace(ctx).requireAdapter(Commands);
await commands.call(ChangeWorkspaceCommand, { files: new MemFilesApi(), label: "scratch" }).promise;
// Without `files`, the handler calls `platform:pick-directory` and binds the folder the user picks.
```

Primitive file commands (handlers from `./files-fragment`):

```ts
import { LoadDirectoryCommand, WriteFileCommand } from "@statewalker/workspace.core";

await commands.call(WriteFileCommand, { path: "/notes/a.md", content: "# A" }).promise;
const entries = await commands.call(LoadDirectoryCommand, { path: "/notes" }).promise;
```

## Internals

### One workspace, three levels of adapter hosts

```
Workspace  (FilesApi, AdaptersRegistry, open/close lifecycle)
  +-- Project   one per top-level directory, cached by name
  |     +-- Resource   any path, cached by full path
  +-- Resource
```

`Workspace`, `Project` and `Resource` extend `Adaptable`. `requireAdapter(Type)` looks in this order: a handle-local `setAdapter` registration, then a factory registered for that level in the shared `AdaptersRegistry`, then the class itself if it is concrete (it is constructed with the handle). Adapter instances are cached strongly per handle, so their identity is stable. Derived values inside adapters (`TextAdapter.textRef` -> `JsonAdapter.jsonRef`) use `newReference`: weak, dependency-tracked, recomputed when garbage-collected or when a dependency changed. Instances are strong and values weak so that subscribers keep a stable adapter while large file contents can still be freed.

The workspace caches resources (up to 1000) and projects (up to 256) in LRUs with a one-hour maximum age. A second `getProject(name)` after eviction returns a new `Project` with new adapter instances; adapters that hold state should keep it on disk, not only in memory.

### Lifecycle rules

- A workspace is created closed. `setFileSystem` works only while closed; `close()` keeps adapter instances (the registry is stable across open/close cycles).
- `open()` runs `onLoad` listeners; `close()` runs `onUnload` listeners. A listener that throws is logged (`[workspace] onLoad listener threw:`) and does not stop the others.
- `workspace:change` always runs `close()`, then `initWorkspace(...)`, then `open()`, so adapters bound to the old folder are torn down first.
- `ProjectBuilder` resolves its logger when it is constructed. Register your `LoggerAdapter` before the first `requireAdapter(ProjectBuilder)`; a later registration is not picked up.

### Why `platform:pick-directory` is declared here

`workspace:change` needs to ask a platform package for a folder, and platform packages depend on this one. Declaring `PickDirectoryCommand` here (commands are keyed by string, so both declarations reach the same handler) avoids a dependency cycle.

### What breaks

| Situation | What you see |
| --- | --- |
| Reading `workspace.files` before `setFileSystem` | `Workspace has no file system installed — call setFileSystem() first` |
| `setFileSystem` on an open workspace | `Workspace.setFileSystem is only legal while closed — call close() first` |
| `open()` without a file system | `Workspace.open requires a file system — call setFileSystem() first` |
| `requireAdapter(Secrets)` (or `Settings`, `SystemFiles`) without `initWorkspace` | `No adapter registered for Secrets` (abstract tokens cannot self-host) |
| A `files:*` command while the workspace is closed | `files:* commands require an open workspace — call runChangeWorkspace first` (there is no `runChangeWorkspace`; call `ChangeWorkspaceCommand`) |
| `MoveFileCommand` on a missing source | `move failed: source missing: <path>` |

`initWorkspace` always uses `secrets/` and `settings/` inside the system folder; it does not read `secretsDir` / `settingsDir` from `WorkspaceConfig`. Its TypeScript signature requires `workspace` even though the code has a default.

### API reference

- Hosts: `Workspace`, `Project`, `Resource`, `Adaptable`, `AdaptersRegistry`, `DEFAULT_SYSTEM_FOLDER` (`.project`); types `AdapterLevel`, `AdapterCtor`, `ConcreteAdapterCtor`, `AdapterFactory`, `AdaptableAdapter`, `WorkspaceAdapter`.
- Context: `getWorkspace(ctx)`, `resetWorkspace(ctx)`; `getWorkspaceConfig`, `setWorkspaceConfig`, `removeWorkspaceConfig`, `WorkspaceConfig`, `DEFAULT_WORKSPACE_CONFIG`.
- Workspace adapters: `SystemFiles`, `Secrets`, `Settings`, `initWorkspace({ workspace, filesApi, systemDir?, label? })`.
- Resource/project adapters: `ResourceAdapter`, `ContentReadAdapter`, `ContentWriteAdapter`, `TextAdapter`, `JsonAdapter`, `Json`, `ProjectAdapter`, `newReference`, `Reference`.
- Logging: `LoggerAdapter`, `ConsoleLoggerAdapter`, `loggerOf`, `loggerMetaOf`, `NULL_LOGGER`, `Logger`, `LoggerLevel`.
- Builds: everything from `@statewalker/webrun-builder` (`BuildEngine`, `SOURCES_SIGNAL`, `SOURCES_REMOVED_SIGNAL`, ...), with `RegisteredBuilder`, `BuilderProvider`, `BuilderHandler` bound to `Project`; `ProjectBuilder`; `ProjectWatcher`, `WatchEvent`, `WatchHandler`, `PollScheduler`, `DEFAULT_WATCH_INTERVAL_MS` (30 s); `applyNature(project, provider)`, `applyNature(workspace, nature)`, `NatureBuilders`, `Nature`, `NatureAdapter`.
- Commands: `ChangeWorkspaceCommand` (`workspace:change`), `PickDirectoryCommand` (`platform:pick-directory`), `LoadDirectoryCommand`, `LoadFileCommand`, `WriteFileCommand`, `MoveFileCommand`, `DeleteFileCommand`, `MkdirCommand`, `RenameCommand` (`files:*`), their payload/result types, `DirectoryEntry`, `LoadedFile`, `CHANGE_WORKSPACE_COMMAND_KEY`, `PICK_DIRECTORY_COMMAND_KEY`.

### Dependencies

- `@statewalker/webrun-files` - the `FilesApi` contract and path helpers.
- `@statewalker/webrun-files-composite` - `CompositeFilesApi`, which gives `SystemFiles` its view of the system folder.
- `@statewalker/webrun-builder` - the generic signal-driven build engine behind `ProjectBuilder`.
- `@statewalker/shared-baseclass` - observable base (`onUpdate`) of the hosts.
- `@statewalker/shared-adapters` - `newAdapter` for `getWorkspace` / workspace config in a fragment context.
- `@statewalker/shared-commands` - command descriptors and the `Commands` adapter.
- `@statewalker/shared-logger` - the `Logger` type and console logger.

`@statewalker/webrun-dataflow` is listed in `dependencies` but no source file imports it.

## License

MIT
