# @statewalker/explorer.core

## What it is

The React-free logic of the file explorer: panel models (`FilesListModel`,
`FilesTreeView`, `SearchModel`), the directory loader (`loadDirectory`,
`createPanelController`), file display helpers (icon, size, date), json-render
spec helpers for explorer panels, the `file-explorer:*` commands, and the slots
through which panels declare presets and register themselves. Its fragment
handles `files:open`: a directory is navigated in an explorer panel, a file is
passed to `files:visualize`.

## Why it exists

The explorer's state and its routing rules are kept away from React so they can
be unit-tested without a DOM and reused outside one fixed layout. The renderer,
`@statewalker/explorer.view.react`, binds the json-render catalog and mounts the
panels; this package decides what a click on a folder or file does.

## How to use

```sh
pnpm add @statewalker/explorer.core
```

No peer dependencies. No DOM or Node APIs. The fragment needs a `Workspace`
(`@statewalker/workspace.core`) with a files API, and the `files:visualize`
handler from `@statewalker/mime.core`.

| Import | Gives |
| --- | --- |
| `@statewalker/explorer.core` | models, loader, commands, slots, display and spec helpers (no default export) |
| `@statewalker/explorer.core/fragment` | default export `initFileExplorer(ctx)`: registers the `files:open` handler; returns `cleanup` |

```ts
import initFileExplorer from "@statewalker/explorer.core/fragment";

const cleanup = initFileExplorer(ctx);
```

## Examples

Load directories into a panel model (`createPanelController`, `loadDirectory`):

```ts
import { createPanelController } from "@statewalker/explorer.core";
import { MemFilesApi } from "@statewalker/webrun-files-mem";

const panel = createPanelController({ files: new MemFilesApi(), title: "Files", initialPath: "/" });
panel.navigate("/docs"); // loads asynchronously into panel.model
const off = panel.model.onUpdate(() => {
  if (!panel.model.loading) console.log(panel.model.getDisplayEntries()); // icon, size, date per entry
});
```

List state (`FilesListModel`); the caller supplies the entries:

```ts
import { FilesListModel } from "@statewalker/explorer.core";

const model = new FilesListModel();
const done = model.startLoading({ path: "/" });
done({ entries: await Array.fromAsync(files.list("/")) }); // or done({ error: "..." })
model.setSort("size"); // "name" | "size" | "lastModified" | "kind"; repeat to reverse
model.setFilter("readme"); // case-insensitive substring
model.toggleHidden();
model.moveCursor(1);
const paths = model.getSelectedOrCursor(); // selected paths, or the cursor entry's path
```

Tree state (`FilesTreeView`), loaded one level at a time:

```ts
import { FilesTreeView } from "@statewalker/explorer.core";

const tree = new FilesTreeView();
tree.setRootNodes(await Array.fromAsync(files.list("/")));
const node = tree.getCursorNode();
if (node) tree.toggleExpand(node);
const toLoad = tree.consumeExpand(); // a directory that needs its children
if (toLoad) tree.setNodeChildren(toLoad, await Array.fromAsync(files.list(toLoad.entry.path)));
```

Search state (`SearchModel`); the caller runs the search and pushes results:

```ts
import { SearchModel } from "@statewalker/explorer.core";

const search = new SearchModel();
search.setPattern("todo");
search.start();
for await (const entry of files.list("/", { recursive: true })) {
  if (search.cancelled) break;
  if (entry.name.includes(search.pattern)) search.addResult(entry);
}
search.markDone();
```

Display helpers:

```ts
import { formatFileDate, formatFileSize, resolveFileIcon, toDisplayEntry } from "@statewalker/explorer.core";

const row = toDisplayEntry(fileInfo); // FileInfo plus display fields
formatFileSize(fileInfo.kind === "file" ? fileInfo.size : undefined);
resolveFileIcon(fileInfo); // icon name
```

Declare a panel preset and open an explorer panel:

```ts
import {
  NewFileExplorerPanelCommand,
  fileExplorerPanelPresetsSlot,
  type FileExplorerPanelPreset,
} from "@statewalker/explorer.core";

const preset: FileExplorerPanelPreset = { id: "left", label: "Tree", side: "left", order: 0, folderNavigationHost: true };
slots.provide(fileExplorerPanelPresetsSlot, preset);

// handled by @statewalker/explorer.view.react
const { panelId } = await commands.call(NewFileExplorerPanelCommand, { label: "Files" }).promise;
```

Spec helpers for an explorer dock panel:

```ts
import { FILE_EXPLORER_CATALOG_ID, fileExplorerPanelId, fileExplorerSpecId, makeFileExplorerSpec } from "@statewalker/explorer.core";

const spec = makeFileExplorerSpec("main", { label: "Files", initialPath: "/", mainViewerHost: true });
// panel id "file-explorer:main", spec id "spec:file-explorer:main", catalog "file-explorer"
```

## Internals

### How `files:open` routes a URI

```
files:open { uri, origin?, target? }
        │
 workspace.files.stats(uri)
        │
        ├─ directory ─► target panel = target (if registered)
        │                           ?? panel with folderNavigationHost
        │                           ?? origin (if registered)
        │                           ?? first registered panel
        │               panel.navigate(uri); dock:focus-panel (best effort)
        │
        └─ file or unknown ─► files:visualize { uri, referencePanelId: mainViewerHost panel }
```

Panels pass themselves as `target`, so a folder clicked in a panel opens in that
panel. Callers without a panel (for example an agent) omit `target` and get the
`folderNavigationHost` panel. Files always open next to the `mainViewerHost`
panel, so viewers land in a known group instead of whichever group had focus.
Mounted panels register an `ActiveFileExplorerPanel` (`navigate`,
`isMainViewerHost`, `isFolderNavigationHost`) under their id in
`activeFileExplorerPanelsSlot`; the handler finds them there.

### Why models do no I/O

`FilesListModel.startLoading` sets the loading state and returns a completion
callback; the model never calls a files API. Models stay synchronous and easy to
test. `createPanelController` is the I/O glue: it owns one `FilesListModel`,
loads directories into it, and navigates to `initialPath` (default `/`) at once
so the first render has entries. It does not subscribe to its own model: opening
files and folders goes through `files:open`, which keeps the controller free of
React lifecycle and StrictMode concerns.

### Non-obvious list and tree behavior

- `loadDirectory` adds a `..` row for every path except `/`. When navigating up,
  `createPanelController` puts the cursor on the folder you came from.
- `getVisibleEntries` hides dot-files unless `toggleHidden` was called, applies
  the filter, keeps `..` first, puts directories before files, then sorts by the
  active field.
- Tree expansion is a hand-off: `toggleExpand` marks an unloaded directory as
  pending, the caller takes it with `consumeExpand`, loads its children, and
  passes them to `setNodeChildren`. `activateCursorEntry` on a file sets a path
  that `consumeSelectFile` returns once.
- All models extend `ViewModel` (`BaseClass` with `title`, `setTitle`, a
  `version` counter bumped on every `notify()`, and a `key` like
  `"FilesListModel-3"`), so React's `useSyncExternalStore` gets a changing
  snapshot value and lists get stable keys.

### What breaks

- `files:open` for a directory with no registered explorer panel rejects with
  `files:open — no active file-explorer panel registered to host folder navigation`.
  The comment next to this code says it falls through instead; it does not.
- A panel id found in the slot snapshot but gone by lookup rejects with
  `files:open — stale panel registration for "<id>"`.
- `loadDirectory` does not throw: a listing error is stored as `model.error`
  (the error message) with an empty entry list.
- `RenamePromptCommand`, `MkdirPromptCommand`, `ConfirmDeleteCommand` and
  `ConfirmCopyMoveCommand` (`file-explorer:rename-prompt`, `mkdir-prompt`,
  `confirm-delete`, `confirm-copy-move`) are declared as prompts that resolve on
  confirm and reject on cancel, but no package registers a handler for them.
  They are `Command.silent`, so a call never settles.

### Constraints

- Primitive file operations are the `files:*` commands of
  `@statewalker/workspace.core`; this package declares only UI orchestration
  commands under `file-explorer:*`.
- The tree loads one level at a time; there is no prefetch.
- `SearchModel` holds state only; it does not search.

### Dependencies

- `@statewalker/webrun-files` — `FileInfo` / `FilesApi` types.
- `@statewalker/shared-baseclass` — change notifications for the models.
- `@statewalker/shared-commands`, `@statewalker/shared-slots`, `@statewalker/shared-registry` — commands, slots, fragment `cleanup`.
- `@statewalker/workspace.core` — `getWorkspace` and `workspace.files`.
- `@statewalker/mime.core` — `OpenCommand`, `VisualizeFileCommand`.
- `@statewalker/shell.core` — `FocusPanelCommand`.
- `@json-render/core` — the `Spec` type returned by `makeFileExplorerSpec`.
- `zod` — listed as a dependency; no source file imports it.

## License

MIT
