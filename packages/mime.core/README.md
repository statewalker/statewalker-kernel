# @statewalker/mime.core

## What it is

The React-free dispatch core for opening files in MIME-typed viewers. It owns
the `files:visualize` / `files:open` commands, declares the extension-point
slots that concrete viewers plug into (`files:mime-renderers`,
`files:mime-icons`, `files:editor-factories`, `files:indexers`), and provides
the `MimeRenderer` contract plus the `pickMimeRenderer` selection policy. Given
a URI it guesses the MIME type from the extension, picks the best registered
renderer, builds a json-render spec, and opens it as a dock panel.

## Why it exists

Viewers (image, markdown, pdf, video, …) must not be hard-wired into the
file-management layer, and the file layer must stay free of React and of any
concrete viewer's catalog id or spec shape. `mime.core` is the seam: it knows
*how* to dispatch a URI to a viewer but nothing about *which* viewers exist.
Each `mime.view.*` fragment contributes a `MimeRenderer` to the
`files:mime-renderers` slot; this package resolves the match and drives the
panel open. It replaces the former monolithic file-viewer wiring with a slot-
based, ADR-0002-compliant logic fragment.

```
files:visualize(uri)
        │
        ▼
 guessMimeType(ext) ──► pickMimeRenderer(slots, mime)   ◄── files:mime-renderers slot
        │                        │                            (image/*, text/markdown, …)
        │                        ▼
        │              renderer.buildPanel(uri) → { catalogId, spec, panelId, specId }
        ▼                        │
 SpecStore.create(spec) ────────►│
        │                        ▼
        └──────────► ShowDockPanelCommand (shell.core)
```

## How to use

```sh
pnpm add @statewalker/mime.core
```

The package is a logic fragment. A host boots it by calling the default export
(also exported from `@statewalker/mime.core/fragment`) with a context that
exposes a `Workspace`:

```ts
import initFiles from "@statewalker/mime.core";

const cleanup = initFiles(ctx); // ctx → getWorkspace(ctx)
// …later
await cleanup();
```

`init` constructs the internal `FilesManager`, which listens for
`VisualizeFileCommand` on the workspace's `Commands` adapter and performs the
dispatch above. The primitive `files:*` filesystem commands (load/write/move)
are owned by `@statewalker/workspace.core`, not here.

## Examples

Contribute a renderer from a viewer fragment:

```ts
import { mimeRenderersSlot, type MimeRenderer } from "@statewalker/mime.core";

const renderer: MimeRenderer = {
  mimeTypePattern: "image/*", // exact MIME or glob with `*`
  order: 100, // lower wins on ties
  buildPanel(uri) {
    return {
      catalogId: "image-viewer",
      spec: makeImageSpec(uri),
      panelId: `image-viewer:${uri}`, // deterministic → reopening focuses the tab
      specId: `spec:image-viewer:${uri}`,
    };
  },
};
slots.provide(mimeRenderersSlot, renderer);
```

Trigger a viewer:

```ts
import { VisualizeFileCommand } from "@statewalker/mime.core";

await commands.call(VisualizeFileCommand, {
  uri: "file:///photos/cat.png",
  referencePanelId: "file-explorer", // optional: anchor the new panel
}).promise;
```

Resolve a renderer directly (the same policy `files:visualize` uses):

```ts
import { pickMimeRenderer } from "@statewalker/mime.core";

const renderer = pickMimeRenderer(slots, "text/markdown");
```

`OpenCommand` (`files:open`) is the smart-open variant: directories navigate a
file-explorer panel, files delegate to `files:visualize`.

## Internals

### Architectural decisions

- **Slot-based dispatch.** Viewers register against `files:mime-renderers`
  rather than being imported. The core never references a concrete viewer's
  catalog id or spec shape; `buildPanel` returns them, keeping `files/` viewer-
  agnostic.
- **Renderer owns its ids.** `MimePanelPlan` carries `panelId` / `specId` built
  by the viewer, deterministically keyed by URI. Opening the same URI twice
  focuses the existing panel instead of duplicating it.
- **ADR-0002 logic/view split.** This package has no React imports. Rendering
  lives in the paired `mime.view.*` packages.
- **Forward-declared slots.** `files:mime-icons`, `files:editor-factories`, and
  `files:indexers` are declared here for forward compatibility; their runners
  land in later waves. The `MimeIcon` / `EditorFactory` / `Indexer` types are
  the contracts those waves will fill.

### Algorithms

- **MIME guessing** — `guessMimeType` maps a file extension through a fixed
  table to a MIME string, defaulting to `application/octet-stream`. The
  `file://` scheme is stripped first.
- **Renderer selection** — `pickRenderer` filters the slot snapshot by
  `mimeTypePattern` (exact match, or glob where `*` becomes `.*` in an anchored
  regex), sorts by `order ?? 100` ascending, and returns the first. No match →
  `undefined`, and `files:visualize` rejects with a descriptive error.
- **Spec lifecycle** — `FilesManager` creates the spec in `SpecStore` only if
  not already present (non-persistent); the dock manager evicts it on last
  panel close.

### Constraints

- MIME detection is extension-based only — no content sniffing.
- A single best renderer is opened; there is no chooser UI for ties.
- The slot/icon/editor/indexer extension points beyond `files:mime-renderers`
  are declarations only at this stage.

### Dependencies

`@statewalker/shared-slots` (extension points), `@statewalker/shared-commands`
(command contracts), `@statewalker/shared-registry` (cleanup registry),
`@statewalker/render.core` (`SpecStore`), `@statewalker/shell.core`
(`ShowDockPanelCommand`), `@statewalker/workspace.core` (`Workspace`,
`getWorkspace`), `@statewalker/webrun-files` (`extname`).

## Related

- `@statewalker/mime.view.image` — `image/*` renderer.
- `@statewalker/mime.view.markdown` — `text/markdown` renderer.
- `@statewalker/mime.view.pdf` — `application/pdf` renderer.
- `@statewalker/mime.view.video` — `video/*` renderer.

## License

MIT — see the monorepo root `LICENSE`.
