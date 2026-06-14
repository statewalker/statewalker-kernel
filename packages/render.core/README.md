# @statewalker/render.core

## What it is

The React-free state layer for the workbench's json-render engine. It holds
[json-render](https://github.com/) specs in a workspace-scoped `SpecStore`
(keyed by id, with stable references and per-id observers), exposes
`spec:create` / `spec:patch` commands to mutate them, ships a
`json:catalogs` slot for registering renderer catalogs, and provides
`restorePanelSpecsFromLayout` to pre-seed specs from a persisted DockView
layout before the React tree mounts. It deliberately carries **no
`@json-render/*` dependency** — specs and registries are held opaquely
(`unknown`); the concrete json-render types live only in
`@statewalker/render.view.react`.

## Why it exists

DockView serializes panel *layout* (which tabs exist, their positions) but
not panel *content*. When a json-render panel is restored from a saved
layout, it needs its spec back synchronously, the moment it renders —
otherwise it flashes a `PanelMissing` placeholder until something else
recreates it. This package owns that out-of-band content store and the
plumbing around it, separated from the rendering boundary so logic
fragments can create and patch specs without pulling React or json-render
into their dependency graph (ADR-0002 logic/view split). It also folds in
the former `@statewalker/catalog-registry` package, which was a single slot
definition plus a no-op fragment — that is now the `catalogsSlot` here.

## How to use

```sh
pnpm add @statewalker/render.core
```

The package is a workspace **logic fragment**. Activate the default export
(also at `./fragment`) after the substrate fragments (CatalogRegistry,
Dock, Workspace-bridge) are wired:

```ts
import initSpecStore from "@statewalker/render.core/fragment";

const cleanup = initSpecStore(ctx); // attaches SpecStore + spec:* handlers
// ... later
await cleanup();
```

After init, any other fragment resolves the store and fires commands
through the workspace's adapters:

```ts
import { SpecStore, CreateSpecCommand, PatchSpecCommand } from "@statewalker/render.core";
import { Commands } from "@statewalker/shared-commands";

const store = workspace.requireAdapter(SpecStore);
const commands = workspace.requireAdapter(Commands);

const { specId } = await commands.call(CreateSpecCommand, {
  catalogId: "chat",
  spec: { type: "chat-panel", sessionId: "abc" },
});
await commands.call(PatchSpecCommand, { specId, patch: { spec: { /* ... */ } } });
```

## Examples

### SpecStore directly

```ts
import { SpecStore } from "@statewalker/render.core";

const store = new SpecStore();

const id = store.create({ catalogId: "pdf-viewer", spec: { src: "/x.pdf" } });
const record = store.get(id);   // stable reference until next mutation for `id`

const stop = store.observe(id, () => render());  // fires on patch/delete
store.patch(id, { spec: { src: "/y.pdf" } });    // notifies observers
store.delete(id);
stop();
```

`create` throws if a caller-supplied id already exists; `patch` throws for
unknown ids. The returned record reference is stable across `get` calls
until a `create` / `patch` / `delete` mutation for that id — required so
`useSyncExternalStore` consumers in the renderer don't loop.

### Restoring specs from a saved layout

Run at fragment-init time, before `DockHost.setApi` calls `fromJSON()`:

```ts
import {
  restorePanelSpecsFromLayout,
  DOCK_LAYOUT_STORAGE_KEY,
} from "@statewalker/render.core";

restorePanelSpecsFromLayout({
  store,
  storage: globalThis.localStorage,
  layoutKey: DOCK_LAYOUT_STORAGE_KEY,
  panelIdPrefix: "pdf-viewer:",
  catalogId: "pdf-viewer",
  buildSpec: (suffix) => ({ src: suffix }),
  buildSpecId: (suffix) => `pdf-viewer:${suffix}`,
  // meta defaults to { persistent: true } so the dock fragment won't evict
});
```

It walks `parsed.panels` keys, matches those starting with `panelIdPrefix`
(and having a non-empty suffix), and inserts one spec each. Idempotent —
existing spec ids are skipped, so hot reload / StrictMode double-mount are
safe.

### Registering a renderer catalog into the slot

```ts
import { catalogsSlot } from "@statewalker/render.core";
import { Slots } from "@statewalker/shared-slots";

const slots = workspace.requireAdapter(Slots);
slots.register(catalogsSlot, "chat", chatRegistry); // registry held opaquely
const reg = slots.get(catalogsSlot, "chat");
```

## Internals

### Architectural decisions

- **No `@json-render/*` dependency.** Specs (`Spec = unknown`) and catalog
  registries are held opaquely. The store never introspects a spec; callers
  cast at the rendering boundary inside the renderer. This keeps logic
  fragments free of React/json-render and is the `.core` half of the
  ADR-0002 split.
- **Out-of-band content store.** DockView persists layout, not content. The
  `SpecStore` is the parallel store keyed by the `specId` that layout JSON
  references via `params: { specId }`, so panels re-render on patch without
  DockView re-serialization.
- **Eviction lives elsewhere.** The store never evicts on its own. The dock
  fragment decides when to delete a spec on panel close, honouring the
  `SpecMeta.persistent` flag (`true` = survives last-panel unmount).
- **Commands are `silent`.** `spec:create` / `spec:patch` are built with
  `Command.silent`, so consumers fire them without importing the adapter.

### Algorithms

`restorePanelSpecsFromLayout` is defensive against DockView serialization
shape changes: it only reads `parsed.panels` keys and ignores everything
else. Non-JSON payloads, missing storage, and missing keys are no-ops
rather than errors. The restore window matters — `JsonPanel` looks the spec
up synchronously when a restored panel renders, so the pass must complete
before the React tree mounts.

### Constraints

- `SpecPatch` is v1 full-replace per provided field — no JSON-Patch / delta
  forms.
- Observers fire on `patch` and `delete`, not at registration time.
- `DOCK_LAYOUT_STORAGE_KEY` (`"chat-mini:dock-layout"`) mirrors
  `@statewalker/dock`'s internal key; it will migrate to a
  `SystemFiles/dock-layout.json` path alongside the dock fragment's
  persistence migration.

### Dependencies

- `@statewalker/shared-commands` — the `Command` builder + `Commands`
  adapter for `spec:create` / `spec:patch`.
- `@statewalker/shared-registry` — LIFO cleanup in the fragment init.
- `@statewalker/shared-slots` — the `json:catalogs` keyed slot.
- `@statewalker/workspace.core` — `getWorkspace` / `requireAdapter` to
  attach the `SpecStore`.

No `@json-render/*` runtime dependency by design.

## Related

- `@statewalker/render.view.react` — the
  React renderer that consumes these opaque specs and registries
  (`<SpecRenderer>`); the `.view.react` half of this `.core` package.

## License

MIT — see the monorepo root `LICENSE`.
