# @statewalker/mime.core

## What it is

The React-free dispatch core for opening files in MIME-typed viewers. It
declares the `files:visualize` and `files:open` commands, the slots viewers plug
into (`files:mime-renderers`, `files:mime-icons`, `files:editor-factories`,
`files:indexers`), and the `MimeRenderer` contract with the `pickMimeRenderer`
selection policy. Its fragment handles `files:visualize`: given a URI, it opens
the file in the best registered viewer as a dock panel.

## Why it exists

The file layer must open a file in "the right viewer" without knowing which
viewers exist, what their json-render catalogs are, or what their specs look
like. This package is that seam. Viewers (for example
`@statewalker/mime.view.image`, `@statewalker/mime.view.markdown`,
`@statewalker/mime.view.pdf`, `@statewalker/mime.view.video`) each contribute a
`MimeRenderer`; this package chooses one and drives the panel open. It imports
no React.

## How to use

```sh
pnpm add @statewalker/mime.core
```

No peer dependencies. No DOM or Node APIs. The fragment needs a `Workspace`
(`@statewalker/workspace.core`) on which the `SpecStore` fragment
(`@statewalker/render.core`) and the dock fragment (`@statewalker/shell.core`)
are booted.

| Import | Gives |
| --- | --- |
| `@statewalker/mime.core` | commands, slots, types, `pickMimeRenderer` (no default export) |
| `@statewalker/mime.core/fragment` | default export `initFiles(ctx)`: registers the `files:visualize` handler, returns `cleanup` |

```ts
import initFiles from "@statewalker/mime.core/fragment";

const cleanup = initFiles(ctx); // reads the Workspace from ctx
// later
await cleanup();
```

## Examples

Contribute a renderer from a viewer fragment:

```ts
import { mimeRenderersSlot, type MimeRenderer } from "@statewalker/mime.core";
import { Slots } from "@statewalker/shared-slots";

const renderer: MimeRenderer = {
  mimeTypePattern: "image/*", // exact MIME type, or a glob with `*`
  order: 100, // lower wins; default 100
  buildPanel(uri) {
    return {
      catalogId: "image-viewer",
      spec: { type: "image", src: uri },
      panelId: `image-viewer:${uri}`,
      specId: `spec:image-viewer:${uri}`,
    };
  },
};
const remove = workspace.requireAdapter(Slots).provide(mimeRenderersSlot, renderer);
```

Open a file in its viewer:

```ts
import { VisualizeFileCommand } from "@statewalker/mime.core";
import { Commands } from "@statewalker/shared-commands";

await workspace.requireAdapter(Commands).call(VisualizeFileCommand, {
  uri: "file:///photos/cat.png",
  referencePanelId: "file-explorer:main", // optional: open in this panel's group
}).promise;
```

Smart open (directory or file); the handler is registered by
`@statewalker/explorer.core`:

```ts
import { OpenCommand } from "@statewalker/mime.core";

await commands.call(OpenCommand, { uri: "/docs" }).promise;
```

Pick a renderer without opening anything:

```ts
import { pickMimeRenderer } from "@statewalker/mime.core";

const renderer = pickMimeRenderer(workspace.requireAdapter(Slots), "text/markdown"); // MimeRenderer | undefined
```

## Internals

### How `files:visualize` opens a file

```
files:visualize { uri, referencePanelId? }
        │
        ▼
 MIME from extension ──► pickMimeRenderer(slots, mime) ◄── files:mime-renderers
        │                        │
        │                        ▼
        │          renderer.buildPanel(uri) → { catalogId, spec, panelId, specId }
        ▼                        │
 SpecStore.create (only if specId is not stored) ◄─┘
        │
        ▼
 dock:show-panel { panelId, specId, title: file name, referencePanelId }
```

### Why the renderer chooses the panel and spec ids

`buildPanel` returns `panelId` and `specId`, built from the URI. Opening the
same URI twice therefore hits an existing panel, and `dock:show-panel` focuses
it instead of adding a duplicate. The spec is created without
`meta.persistent`, so the dock deletes it when its last panel closes.

### How a renderer is chosen

`pickMimeRenderer` keeps the slot entries whose `mimeTypePattern` equals the
MIME type, or matches it as a glob (`*` becomes `.*` in a regex anchored at both
ends). It sorts them by `order ?? 100` and returns the first. Use it instead of
re-implementing the policy, so all callers agree on the winner.

### What breaks

- No renderer matches: `files:visualize` rejects with
  `No mime-renderer registered for "<mime>"`.
- Unknown extension: the MIME type is `application/octet-stream`, which usually
  has no renderer, so the error above names `application/octet-stream`.
- If no handler is registered (the fragment was not booted, or for
  `files:open`, `@statewalker/explorer.core` was not), the returned promise
  rejects at once with a `CommandError` with `kind: "no-handlers"`.

### Constraints

- MIME detection uses the file extension only, from a fixed internal table
  (Markdown, text, JSON, JS/TS, HTML, CSS, common images, PDF, MP4/WebM/OGG/MOV).
  `.ogg` maps to `video/ogg`.
- One renderer is opened; there is no chooser when several match.
- The tab title is always the file name. `MimePanelPlan.title` is not used.
- `files:mime-icons`, `files:editor-factories` and `files:indexers` are
  declared with their types (`MimeIcon`, `EditorFactory`, `Indexer`), but
  nothing in this package reads them.

### Dependencies

- `@statewalker/shared-slots` — slot declarations.
- `@statewalker/shared-commands` — command declarations and the `Commands` bus.
- `@statewalker/shared-registry` — `cleanup` of the fragment.
- `@statewalker/render.core` — `SpecStore`, where the viewer's spec is stored.
- `@statewalker/shell.core` — `ShowDockPanelCommand`, to open the panel.
- `@statewalker/workspace.core` — `getWorkspace`.
- `@statewalker/webrun-files` — `extname`.
- `@statewalker/webrun-files-mem` — listed as a dependency, but only the tests import it.

## License

MIT
