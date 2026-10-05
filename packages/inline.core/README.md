# @statewalker/inline.core

## What it is

The React-free contract for inline content blocks: structured, interactive
blocks (a metric card, a small chart, a file reference) that an assistant
message embeds instead of plain prose. It declares the
`inline-content:components` discovery slot and the two types that describe a
block: `InlineContentSpec` (what a message carries) and
`InlineComponentDescriptor` (what a component advertises about itself).

## Why it exists

Tooling, plug-in managers and the agent need to list the available inline
components without loading React. This package holds only that data contract.
The components and the `inline-content:renderers` lookup slot, whose values are
React components, live in the renderer package `@statewalker/inline.view.react`.

## How to use

```sh
pnpm add @statewalker/inline.core
```

No peer dependencies. No DOM or Node APIs.

| Import | Gives |
| --- | --- |
| `@statewalker/inline.core` | `inlineComponentSlot`, `InlineContentSpec`, `InlineComponentDescriptor` |
| `@statewalker/inline.core/fragment` | default export `initInlineContent(ctx)`, the logic-fragment init; returns a `cleanup` function |

## Examples

The block an assistant message carries:

```ts
import type { InlineContentSpec } from "@statewalker/inline.core";

const spec: InlineContentSpec = {
  componentId: "metric-card",
  props: { label: "Revenue", value: "$1.2M", delta: "+8%", trend: "positive" },
};
```

Advertise a component for discovery:

```ts
import { inlineComponentSlot, type InlineComponentDescriptor } from "@statewalker/inline.core";
import { Slots } from "@statewalker/shared-slots";

const descriptor: InlineComponentDescriptor = {
  id: "metric-card",
  label: "Metric Card",
  description: "Single-value KPI card with optional delta and trend.",
};
const remove = workspace.requireAdapter(Slots).provide(inlineComponentSlot, descriptor);
```

## Internals

### Why `props` is `unknown`

`InlineContentSpec.props` is opaque so the contract does not depend on any
component's prop shape. Each component validates and casts its props when it
renders. `SpecStore` in `@statewalker/render.core` holds json-render specs the
same way.

### Discovery and rendering are separate slots

`inlineComponentSlot` carries descriptors only, for listing. Resolving a
`componentId` to a component uses a separate keyed slot owned by the renderer,
because its values are React-typed. A descriptor in this slot does not mean a
renderer is registered: the renderer fragment contributes both.

### The fragment init does nothing

The slot is a plain declaration exported from the main entry point, so
`initInlineContent` only returns an empty `cleanup`. It exists so a host boots
this package like every other fragment.

### Dependencies

- `@statewalker/shared-slots` — `defineSlot`.
- `@statewalker/shared-registry` — the `cleanup` returned by init.

## License

MIT
