# @statewalker/render.view.react

## What it is

The package where json-render specs become React elements. It exports
`<SpecRenderer>`, which renders a json-render `spec` against a `registry`
inside a `<JSONUIProvider>`, and re-exports `@json-render/react`'s
`defineRegistry`, `schema` and state hooks so view packages can build
catalogs and component bindings without importing `@json-render/react`
themselves.

## Why it exists

`@statewalker/render.core` stores specs (in the `SpecStore`) and registries
(in the `json:catalogs` slot) as opaque `unknown` values, so logic packages
depend on neither json-render nor React. The concrete json-render types have
to appear somewhere for anything to render. This package is that place: one
file casts the opaque values to json-render types, and every other view
package goes through it.

## How to use

```sh
pnpm add @statewalker/render.view.react
```

Peer dependencies: `react` and `react-dom` (`>=18`).

| Import | Provides |
| --- | --- |
| `@statewalker/render.view.react` | `SpecRenderer`, `SpecRendererProps`, re-exports from `@json-render/react` |

There is no `./fragment` and no `./styles` entry: the package registers nothing.

```tsx
import { SpecRenderer } from "@statewalker/render.view.react";

<SpecRenderer spec={record.spec} registry={registry} />;
```

`SpecRendererProps`:

- `spec: unknown` — a json-render spec, as held by the `SpecStore`.
- `registry: unknown` — a json-render registry, as held by the `json:catalogs` slot.
- `store?: unknown` — an external json-render `StateStore`. Pass one when code
  outside the spec must seed or update the state the spec reads. When omitted,
  `<JSONUIProvider>` creates its own store, which is enough for self-contained
  specs.
- `handlers?: unknown` — the action handlers,
  `{ [actionName]: (params) => void | Promise<void> }`.

## Examples

### Define a catalog, bind it, render a spec

```tsx
import { defineCatalog } from "@json-render/core";
import { defineRegistry, schema, SpecRenderer } from "@statewalker/render.view.react";
import { z } from "zod";

const catalog = defineCatalog(schema, {
  components: { Hello: { props: z.object({ name: z.string() }) } },
  actions: {},
});

const { registry } = defineRegistry(catalog, {
  components: { Hello: ({ props }) => <p>Hello, {props.name}</p> },
  actions: {},
});

<SpecRenderer spec={spec} registry={registry} />;
```

### Bind a component to spec state

```tsx
import { useBoundProp, useStateValue } from "@statewalker/render.view.react";
```

These are the `@json-render/react` hooks, re-exported unchanged.

## Internals

### Actions do nothing without `handlers`

json-render's `ActionProvider` resolves action handlers from the `handlers`
prop, not from the action schemas in the registry. A spec whose elements
dispatch `on.<event>` actions but is rendered without `handlers` logs
`No handler registered` and the click has no effect.

### Why both `<JSONUIProvider>` and `<Renderer>`

`<Renderer>` reads the visibility, validation and state contexts that
`<JSONUIProvider>` sets up. A spec rendered without the provider does not
render correctly, so `SpecRenderer` always wraps one.

### Why the props are `unknown`

The stores hold specs and registries opaquely. `SpecRenderer` casts them to
`any` in one place (with lint suppressions), so the casts do not spread into
other packages.

### Dependencies

- `@json-render/core`, `@json-render/react` — the rendering engine this package wraps.
- `react`, `react-dom` — peers.

Used by `@statewalker/shell.view.react` (its `json` dock panel) and by the
catalog bindings in the other view packages.

## License

MIT
