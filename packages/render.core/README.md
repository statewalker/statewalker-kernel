# @statewalker/render.core

## What it is

The React-free state layer for json-render dock panels. It keeps specs in a
workspace-scoped `SpecStore` (by id, with stable references and per-id
observers), handles the `spec:create` / `spec:patch` commands, declares the
`json:catalogs` keyed slot for renderer catalogs, and provides `LayoutStore`,
which keeps the dock layout in `dock-layout.json` under the workspace's
`SystemFiles`. `restorePanelSpecsFromLayout` re-creates panel specs from a saved
layout.

## Why it exists

DockView saves which panels exist and where, but not what they show. Each panel
stores only a `specId`; the spec itself lives here. Logic fragments create and
patch specs through this package without depending on React or on
`@json-render/*`: specs and catalogs are held as `unknown`, and the concrete
json-render types appear only in the renderer, `@statewalker/render.view.react`.

## How to use

```sh
pnpm add @statewalker/render.core
```

No peer dependencies. No DOM requirement (`LayoutStore` touches
`globalThis.localStorage` only when it exists).

| Import | Gives |
| --- | --- |
| `@statewalker/render.core` | `SpecStore`, `LayoutStore`, `CreateSpecCommand`, `PatchSpecCommand`, `catalogsSlot`, `restorePanelSpecsFromLayout`, types (no default export) |
| `@statewalker/render.core/fragment` | default export `initSpecStore(ctx)`: attaches `SpecStore` to the workspace and handles `spec:create` / `spec:patch`; returns `cleanup` |

```ts
import initSpecStore from "@statewalker/render.core/fragment";

const cleanup = initSpecStore(ctx);
```

## Examples

Create and patch a spec through commands:

```ts
import { CreateSpecCommand, PatchSpecCommand } from "@statewalker/render.core";
import { Commands } from "@statewalker/shared-commands";

const commands = workspace.requireAdapter(Commands);
const { specId } = await commands.call(CreateSpecCommand, {
  catalogId: "chat",
  spec: { type: "chat-panel", sessionId: "abc" },
}).promise;
await commands.call(PatchSpecCommand, {
  specId,
  patch: { spec: { type: "chat-panel", sessionId: "def" } },
}).promise;
```

Use `SpecStore` directly:

```ts
import { SpecStore } from "@statewalker/render.core";

const store = workspace.requireAdapter(SpecStore);
const id = store.create({ catalogId: "pdf-viewer", spec: { src: "/x.pdf" } }); // "spec:<uuid>"
const record = store.get(id); // { catalogId, spec, meta } | null
const stop = store.observe(id, () => console.log("changed")); // on patch and delete
store.patch(id, { spec: { src: "/y.pdf" } });
store.delete(id);
stop();
```

Re-create panel specs from the saved layout, in a fragment's `onLoad`:

```ts
import { LayoutStore, SpecStore, restorePanelSpecsFromLayout } from "@statewalker/render.core";

workspace.onLoad(() => {
  restorePanelSpecsFromLayout({
    store: workspace.requireAdapter(SpecStore),
    layout: workspace.requireAdapter(LayoutStore).get(),
    panelIdPrefix: "pdf-viewer:",
    catalogId: "pdf-viewer",
    buildSpec: (suffix) => ({ src: suffix }),
    buildSpecId: (suffix) => `pdf-viewer:${suffix}`,
  });
});
```

Register and look up a renderer catalog:

```ts
import { catalogsSlot } from "@statewalker/render.core";
import { Slots } from "@statewalker/shared-slots";

const slots = workspace.requireAdapter(Slots);
const remove = slots.register(catalogsSlot, "chat", chatRegistry);
const registry = slots.get(catalogsSlot, "chat"); // unknown | null
```

## Internals

### Why `get` returns the same object until the spec changes

`SpecStore.get(id)` returns the same record object across calls until a
`create`, `patch` or `delete` for that id. React's `useSyncExternalStore`
compares snapshots by reference and loops when every read returns a new object.
Observers are called on `patch` and `delete`, not on registration; an observer
that throws is caught, so the others still run.

### Why specs must be restored before the layout is applied

When the dock re-creates a panel from a saved layout, the renderer looks up the
panel's spec synchronously. If it is missing, the tab shows a "panel missing"
placeholder until something re-creates the spec. `restorePanelSpecsFromLayout`
must therefore run in `workspace.onLoad`, before the dock applies the layout.
It reads only the keys of `layout.panels`, so other changes in DockView's
serialized format do not affect it. For each panel id that starts with
`panelIdPrefix` and has a non-empty suffix it creates one spec, with
`meta: { persistent: true }` unless `meta` is given. Ids already in the store are
skipped, so repeated calls (hot reload, StrictMode double mount, reconnect) are
safe. A missing layout or a non-object `panels` is a no-op.

### Who deletes specs

`SpecStore` never evicts. The dock (`@statewalker/shell.core`) deletes a spec
when its last panel closes, unless `meta.persistent === true`.

### How `LayoutStore` loads and saves

- `get()` / `set(layout)` work on an in-memory copy. `set` schedules one write
  per burst (a microtask plus a zero-delay timeout), so many `set` calls in the
  same tick produce one write of the latest layout.
- `connect()` runs on `workspace.onLoad`. The adapter registers that listener in
  its constructor, so the first consumer that resolves it gets the file loaded
  before its own `onLoad` handlers run. Concurrent `connect()` calls share one run.
- An existing `dock-layout.json` always wins and is never overwritten on load.
  If there is no file, a layout stored in `localStorage` under
  `chat-mini:dock-layout` is imported once and written to the file; otherwise
  the in-memory layout, if any, is written.
- `SystemFiles` is touched only on connect, because it throws before a file
  system is installed.

### What breaks

- `store.create` with an existing id throws `SpecStore: spec id "<id>" already exists`.
- `store.patch` with an unknown id throws `SpecStore: cannot patch unknown spec id "<id>"`.
  Through `spec:patch` this becomes a rejected command.
- A corrupt `dock-layout.json` is not an error: the console shows
  `[layout-store] corrupt dock-layout.json — using default layout` and the dock
  starts empty. Read and write failures log
  `[layout-store] failed to read dock-layout.json` /
  `[layout-store] failed to persist dock-layout.json`; `connect()` never rejects.
- The commands are `Command.silent`: without `initSpecStore`, their promises never settle.

### Constraints

- `SpecPatch` replaces each field it provides (`catalogId`, `spec`, `meta`).
  There is no partial or JSON-Patch form.
- Generated ids are `spec:` plus `crypto.randomUUID()`, so `crypto.randomUUID`
  must exist.

### Dependencies

- `@statewalker/shared-commands` — `spec:create` / `spec:patch`.
- `@statewalker/shared-registry` — fragment `cleanup`.
- `@statewalker/shared-slots` — the `json:catalogs` slot.
- `@statewalker/workspace.core` — `getWorkspace`, `SystemFiles`.
- `@statewalker/webrun-files` — reading and writing `dock-layout.json`.

No `@json-render/*` dependency.

## License

MIT
