# @statewalker/explorer.core

## What it is

The React-free logic half of the workbench file explorer. It owns the
reactive panel models (`FilesListModel`, `FilesTreeView`, `SearchModel`),
the directory-loading orchestrator (`createPanelController` / `PanelController`),
the file-icon/size/date display resolver, the `file-explorer:*` orchestration
commands, the json-render spec helpers, and the extension-point slots that let
panels advertise themselves and host file/folder activations. Its paired
renderer is `@statewalker/explorer.view.react`.

## Why it exists

Per ADR-0002 (logic / view split) the explorer is two packages. This one holds
everything that does not touch React, so the panel state machine, the directory
I/O glue, and the activation-routing command handler can be unit-tested without
a DOM and reused outside the canonical two-pane layout. The split also keeps the
`files:open` routing handler (which decides which panel a click navigates into,
and where a viewer tab docks) free of any React lifecycle / StrictMode coupling.

It is the "logic fragment" registered into a `Workspace`; the view fragment binds
the json-render catalog and mounts the actual panels.

## How to use

```sh
pnpm add @statewalker/explorer.core
```

Two entry points:

- `@statewalker/explorer.core` — all public symbols (models, controller,
  commands, slots, display helpers, spec helpers).
- `@statewalker/explorer.core/fragment` — the default-exported
  `initFileExplorer(ctx)` logic-fragment init, registered by the host app.

The init reads the `Workspace` from `ctx` (`getWorkspace`), grabs its `Commands`
and `Slots` adapters, and registers the `files:open` (`OpenCommand`) handler.
Mounted panels register an `ActiveFileExplorerPanel` into
`activeFileExplorerPanelsSlot`; the handler resolves the target panel from that
slot. It returns a `cleanup` thunk.

## Examples

Drive a panel's model directly (e.g. in a test) with `MemFilesApi`:

```ts
import { createPanelController, loadDirectory } from "@statewalker/explorer.core";
import { MemFilesApi } from "@statewalker/webrun-files-mem";

const files = new MemFilesApi();
const panel = createPanelController({ files, title: "Files", initialPath: "/" });
panel.navigate("/docs");           // async load into panel.model
const rows = panel.model.getDisplayEntries();   // FileDisplayEntry[] (icon, size, date)
```

Sortable / filterable list state:

```ts
import { FilesListModel } from "@statewalker/explorer.core";

const model = new FilesListModel();
const done = model.startLoading({ path: "/" });
done({ entries: await collect(files.list("/")) });
model.setSort("size");        // toggles asc/desc on repeat
model.setFilter("README");
model.toggleHidden();
model.moveCursor(1);
const selected = model.getSelectedOrCursor();   // string[] of paths
```

Lazy tree state:

```ts
import { FilesTreeView } from "@statewalker/explorer.core";

const tree = new FilesTreeView();
tree.setRootNodes(rootEntries);
const node = tree.getCursorNode();
tree.toggleExpand(node!);                 // sets pendingExpand for dir nodes
const toLoad = tree.consumeExpand();      // orchestrator loads children…
tree.setNodeChildren(toLoad!, childEntries);   // …and pushes them back
```

Declare an explorer panel preset (consumed by the renderer's two-pane init):

```ts
import { fileExplorerPanelPresetsSlot, type FileExplorerPanelPreset } from "@statewalker/explorer.core";
import { Slots } from "@statewalker/shared-slots";

const preset: FileExplorerPanelPreset = {
  id: "left", label: "Tree", side: "left", order: 0, folderNavigationHost: true,
};
workspace.requireAdapter(Slots).provide(fileExplorerPanelPresetsSlot, preset);
```

Open a fresh panel programmatically:

```ts
import { NewFileExplorerPanelCommand } from "@statewalker/explorer.core";
const { panelId } = await commands.call(NewFileExplorerPanelCommand, { label: "Files" }).promise;
```

## Internals

### Architectural decisions

- **Models are pure data; I/O lives outside.** `FilesListModel.startLoading`
  flips loading state and returns a completion callback the orchestrator invokes
  with results. The model never calls `FilesApi` itself — this keeps it
  synchronous and trivially testable.
- **Activation never flows through model state.** Folder navigation and file
  opening are dispatched via the `files:open` (`OpenCommand`) command, not by
  mutating a model field. The `PanelController` deliberately does *not* subscribe
  to its own model, so it carries no lifecycle coupling.
- **`files:open` routing handler** (in `init.ts`) probes the URI's kind on the
  workspace `FilesApi`. Directories route by priority `target` → the
  `folderNavigationHost` panel → `origin` → first registered panel, then focus
  that tab; files go through `files:visualize` with `referencePanelId` set to the
  `mainViewerHost` panel so viewers always dock into a known group.
- **`file-explorer:*` vs `files:*` namespacing.** Per the `file-management-split`
  capability, only orchestration UI commands (rename/mkdir prompts, confirm
  dialogs, new-panel) live here; primitive file ops stay on `files:*` in the
  files package and are not re-declared.
- **Spec helpers split across ADR-0002.** This package owns the React-free
  `makeFileExplorerSpec` / id helpers (`fileExplorerPanelId`,
  `fileExplorerSpecId`, `FILE_EXPLORER_CATALOG_ID`); the schema-typed
  `defineCatalog` binding lives on the React side because it needs
  `@json-render/react`'s `schema`.

### Algorithms

- **`getVisibleEntries`** applies hidden-file and substring filters, always
  keeps a leading `".."`, then sorts directories before files and within each
  group by the active field/direction.
- **Tree expansion** is a two-phase hand-off: `toggleExpand` sets `pendingExpand`
  + `loading` for an un-loaded directory; the orchestrator calls `consumeExpand`,
  fetches children, and calls `setNodeChildren`. `pendingSelectFile` works the
  same way for file activation.
- **`loadDirectory`** synthesises the `".."` parent row for non-root paths and,
  when navigating up, restores the cursor onto the child you came from.
- **`ViewModel`** bumps a monotonic `version` on every `notify()` so the
  renderer's `useSyncExternalStore` reads stay referentially stable, and assigns
  a per-class auto-incremented `key` usable as a React list key.

### Constraints

- Models hold no `FilesApi` reference; a caller must supply directory contents.
- Tree mode loads one level at a time; there is no recursive prefetch.
- The `files:open` handler is forgiving of teardown timing — if no panel is
  mounted for a file it still visualises; for a directory with no panel it throws.

### Dependencies

`@statewalker/webrun-files` (`FileInfo` / `FilesApi` types), `shared-baseclass`
(`BaseClass` reactive base), `shared-commands` (`Command` builder),
`shared-slots` (extension-point slots), `shared-registry` (init cleanup),
`@statewalker/workspace.core` (`getWorkspace`), `@statewalker/shell.core`
(`FocusPanelCommand`), `@statewalker/mime.core` (`OpenCommand`,
`VisualizeFileCommand`), `@json-render/core` (`Spec` type), `zod`.

## Related

- `@statewalker/explorer.view.react` — the
  paired React renderer (catalog binding, panels, list/tree/breadcrumb views,
  two-pane preset application).
- `@statewalker/workspace.core` — the `Workspace`
  / adapter host this fragment plugs into.
- `@statewalker/mime.core` — owns
  `files:open` / `files:visualize`.

## License

MIT — see the monorepo root `LICENSE`.
