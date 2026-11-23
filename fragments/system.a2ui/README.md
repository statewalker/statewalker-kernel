# system.a2ui

## What it is

The core fragment that renders declarative surfaces. It opens the `catalog` extension point in its client aspect, holds the A2UI 1.0 surfaces that agents and server halves send, validates them strictly against the catalog on [`@a2ui/web_core`](https://www.npmjs.com/package/@a2ui/web_core) (pinned at 0.15.0), routes component events to commands, and its client half renders surfaces with React, inline or popped out into the workbench's dock. It is a private workspace package, `@statewalker/system.a2ui`, in two halves: `src/` (React-free, tested in Node at seam 1) and `client/` (React).

## Why it exists

ADR `2026-11-20-a2ui-client-spec-layer` (statewalker-root) makes A2UI 1.0 the platform's only declarative UI layer, with catalog components defined once by `defineComponent`, a thin renderer of our own on `@a2ui/web_core`, strict validation, events routed by component type, two-way binding for editable state and a 0.9.1 shim. ADR `2026-11-20-kernel-and-core-fragments` gives the `catalog` point and the surface renderer to this fragment. The code is the A2UI prototype (statewalker-kernel branch `claude/great-faraday-igm9os`, `protos/a2ui-surface/`) brought into the platform: its 39 tests run here unchanged in substance (`tests/*.test.ts[x]` other than `fragment`, `dock`).

## How to use

```ts
import {
  createSystemA2ui,
  defineComponent,
  installA2ui,
  installedA2ui,
  SYSTEM_A2UI_ID,
  systemA2uiArchive,
} from "@statewalker/system.a2ui";
import { A2uiSurfaceView, createSurfaceDock } from "@statewalker/system.a2ui/client"; // React
import "@statewalker/system.a2ui/client.css"; // its prebuilt CSS, once per page
```

| Export | Provides |
| --- | --- |
| `systemA2uiArchive`, `SYSTEM_A2UI_ID` | The fragment's files, for `createKernel({ core })`. |
| `createSystemA2ui({ commands, policy?, approve?, legacyCatalogIds?, onLog?, onAction? })` → `{ a2ui, activate }` | The model and the body of the fragment's client activator. |
| `A2ui` | `catalog()`, `components()`, `refusals()`, `ready()`, `process(messages, { origin, title? })`, `surface(id)`, `surfaces()`, `delete(id)`, `popOut(id)`, `popIn(id)`, `setDocked(id, docked)`, `observe(listener)`, `log`. |
| `defineComponent({ name, description?, props, events, commands?, literalOnly?, render })` | A catalog component: Zod props and events, events mapped to command ids, the view (usually `lazy`). |
| `installA2ui(a2ui)`, `installedA2ui()` | The model the shell installs, for fragments' client halves (the module is shared through the import map). |
| `buildCatalog`, `BASIC_COMPONENTS`, `PLATFORM_CATALOG_ID`, `createProcessor` | A catalog from web_core's basic components plus ours; web_core with strict validation. |
| `createActionRouter`, `emitComponentEvent` | Component events to commands, with Allow/Ask/Block for agents' surfaces. |
| `upgradeV09Message` | The 0.9/0.9.1 → 1.0 shim (`process` applies it with `legacyCatalogIds`). |
| `importJsonRenderCatalog`, `jsonRenderPropsFromEntry` | The one-time json-render import. |
| `OPEN_SURFACE_COMMAND`, `CLOSE_SURFACE_COMMAND`, `A2uiError` | The dock's commands (system.workbench's); the model's refusals. |
| `./client`: `A2uiSurface`, `A2uiNode`, `basicRenderers`, `createRegistry`, `viewOf` | The renderer: a surface from its model and a registry of React views. |
| `./client`: `A2uiSurfaceView`, `createSurfaceDock` | A surface with its "Pop out" / "Back inline" controls; the workbench's surface source. |

## Examples

A fragment defines a component in its client half. The definition is light (schemas, command ids); the view loads on first placement:

```tsx
import { defineComponent } from "@statewalker/system.a2ui";
import { lazy } from "react";
import { z } from "zod";

export const NoteEditor = defineComponent({
  name: "NoteEditor",
  props: z.object({ value: z.string() }), // bindable: a literal or {"@path": ...}
  events: z.object({ save: z.object({ value: z.string() }) }),
  commands: { save: "org.example.notes/save" }, // the event runs this command
  render: lazy(() => import("./note-editor-view.js")),
});
```

and contributes it in `fragment.client.jsonc`, with no `requires` on system.a2ui:

```jsonc
{
  "extensions": [
    {
      "point": "catalog",
      "data": { "name": "NoteEditor" },
      "reference": { "module": "./index.js", "export": "NoteEditor" }
    }
  ]
}
```

A view that edits writes back through the binding: `write("value", text)` stores the user's text at the path the surface bound `value` to, so a later update built from the data model keeps it. A value pushed to that path arrives as a new `props.value`, which the view applies in place.

The shell wires the fragment (apps/notes' `boot.ts` and `main.tsx`):

```ts
const a2ui = createSystemA2ui({ commands: commands.bus }); // policy and approve from system.security
// activators: system.a2ui → a2ui.activate(context)
installA2ui(a2ui.a2ui);
workbench.setSurfaceSource(createSurfaceDock(a2ui.a2ui));

await a2ui.a2ui.process(messages, { origin: "agent", title: "Trip notes" });
// in a view: <A2uiSurfaceView surfaceId="demo" />
```

## Internals

### The catalog

An extension to `catalog` carries the component's name (`^[A-Z][A-Za-z0-9]*$`); its reference resolves to the `defineComponent` result. While its client aspect is active, the model follows the point, resolves each reference and builds the catalog `PLATFORM_CATALOG_ID` from web_core's basic catalog (only `Text`, `Column`, `Row`, `Card`, `Button`, the ones `basicRenderers` draws) plus the contributed components. A contribution is refused, with a reason in `refusals()`, when its reference fails or is no definition, when the definition's name is not the contributed one, when it would replace a basic component, or when the name is taken. A fragment disabled takes its components out; surfaces created after that cannot place them, and surfaces already shown render them as refused.

`defineComponent` turns the Zod props into the A2UI 1.0 entry (JSON Schema, `component` discriminator), strict: an undeclared prop is an error. Every prop is bindable (A2UI's dynamic types) unless `literalOnly`; unions are refused (nullable is rewritten, since web_core checks no `anyOf`); bound values are parsed against the Zod schema at render (`viewOf`), and a mismatch renders a placeholder.

### Surfaces

`process` takes 1.0 messages (0.9/0.9.1 ones through the shim, when their catalog id is mapped). Each surface has its own web_core `MessageProcessor` with `STRICT_VALIDATION`, built on the catalog of the moment, and keeps the origin (`agent`, `server`, `user`) and title it was created with. A creation with any error is dropped whole; a message for another origin's surface is refused. Placement is `inline` or `docked`: `popOut` runs `system.workbench/open-surface`, `popIn` `system.workbench/close-surface`, and the workbench tells the model through `createSurfaceDock` (`setDocked`), including when the user closes the dock's panel.

### Events

A2UI has no component events; ours enter web_core's action path (`emitComponentEvent`). The router reads the component's type from the surface model, never from the payload, maps the event to the command its definition names, and parses the payload with the event's Zod schema. An agent's surface passes `policy` (Allow/Ask/Block; `ask` by default) and `approve` (denies by default) before the command runs; a server half's or the user's surface does not. Actions no component declares (an agent-wired Button) go to `onAction`, for the surface's sender.

### The renderer

`A2uiSurface` resolves the tree with web_core's `NodeResolver` and renders only registered components; a component keeps its identity across updates, so a stateful view (an editor, a map) is never remounted by one. `A2uiSurfaceView` adds the placement controls; inline, a docked surface leaves a placeholder with "Bring back".

### Threat model

Surfaces are untrusted input: an agent, or a server half speaking for one, writes them. Catalog components are privileged code, reviewed like any fragment code.

| Threat | Defence | Tests |
| --- | --- | --- |
| A component the catalog does not hold (`Html`, `script`, an iframe) | web_core's strict validation refuses it on input, and the creation is dropped; the renderer refuses any type its registry lacks | `fragment.test.ts` "refuse an unknown component, and raw HTML or script in props, on input"; `decisions.test.tsx` "rejects an unknown component type on input"; `renderer.test.tsx` "renders a refusal placeholder…", "refuses a catalog component that has no registered React implementation"; apps/notes `surfaces.e2e.test.ts` "…unknown component or raw HTML is refused" |
| Raw HTML or event handlers in props (`dangerouslySetInnerHTML`, `onclick`) | Entries are strict objects: an undeclared prop is an error; no renderer uses `dangerouslySetInnerHTML` | `fragment.test.ts` (same test); `renderer.test.tsx` "the processor rejects an extra dangerouslySetInnerHTML prop…" |
| Markup or script in string props | Rendered as text by React | `renderer.test.tsx` "renders raw HTML and script in props as text" |
| A web_core basic component the platform does not draw (`Slider`, …) | Left out of the catalog, refused on input | `fragment.test.ts` (same test) |
| A bound value of the wrong type (the data model is untyped) | Parsed against the component's Zod props at render; a placeholder instead | `decisions.test.tsx` "a bound value of the wrong type is refused at render" |
| An agent spoofing a component's event (naming `confirm` on a Button) | The type comes from the surface model, and only declared events with a command mapping route | `actions.test.tsx` "an agent cannot spoof a mapped event…" |
| A malformed event payload | Parsed against the event's Zod schema; not run | `actions.test.tsx` "an event payload that fails the component's event schema is rejected" |
| An agent's event running a command unasked | Allow/Ask/Block, fail-closed by default (no policy: denied) | `actions.test.tsx` Allow/Ask/Block tests; `fragment.test.ts` "…are denied without a policy (fail-closed)" |
| An agent updating a server half's surface (whose events skip the policy) | A message for another origin's surface is refused | `fragment.test.ts` "refuse an update to another origin's surface" |
| A fragment replacing a basic component or another's name | Refused contributions | `fragment.test.ts` "refuses a contribution that…" |
| Unions slipping past web_core's unchecked `anyOf` | `defineComponent` refuses unions | `decisions.test.tsx` "defineComponent refuses unions in props" |

Not covered: patching large documents, and conflicts between an agent's update and a pending write-back (the last writer wins), statewalker-root#213.

### Dependencies

- `@a2ui/web_core` (0.15.0, pinned): the protocol, validation, data model and tree resolution. Its basic catalog pulls in Lit web components (about 840 kB in the prototype) until upstream exports Lit-free definitions.
- `zod` (4): the definitions. web_core uses zod 3; the two meet only through JSON Schema.
- `@statewalker/kernel.core`: the activation context, the archive type.
- `react`/`react-dom` as peers: the client half, shared by the shell's import map in a browser.

## License

MIT. See [LICENSE](../../LICENSE).
