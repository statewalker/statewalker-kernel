# @statewalker/inline.core

## What it is

The React-free logic half of the inline-content subsystem. It declares the
`inline-content:components` discoverability slot and the two cross-cutting types
that describe an inline content block: `InlineContentSpec` (what a structured
message carries) and `InlineComponentDescriptor` (what each component advertises
about itself). The actual React components and the rendering lookup table live
in its paired renderer,
`@statewalker/inline.view.react`.

## Why it exists

Inline content lets an assistant message embed structured, interactive blocks —
a metric card, a small chart, a clickable file reference — instead of plain
prose. Per ADR-0002 the subsystem is split: this package holds only the
framework-neutral contract (the spec shape and the discoverability slot) so
tooling, plug-in managers, and the agent can enumerate available components
without depending on React. The React-typed rendering slot
(`inline-content:renderers`) and the components themselves belong to the
renderer side.

## How to use

```sh
pnpm add @statewalker/inline.core
```

Two entry points:

- `@statewalker/inline.core` — the types and the
  `inlineComponentSlot` declaration.
- `@statewalker/inline.core/fragment` — the default-exported
  `initInlineContent(ctx)` logic-fragment init. The descriptor slot is pure data,
  so init is a no-op that just returns a `cleanup` thunk.

## Examples

The structured block an assistant message carries:

```ts
import type { InlineContentSpec } from "@statewalker/inline.core";

const spec: InlineContentSpec = {
  componentId: "metric-card",
  props: { label: "Revenue", value: "$1.2M", delta: "+8%", trend: "positive" },
};
// props is intentionally `unknown` — the component casts at its render boundary.
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
workspace.requireAdapter(Slots).provide(inlineComponentSlot, descriptor);
```

## Internals

### Architectural decisions

- **`props: unknown`.** The spec holds props opaquely (same way json-render's
  `SpecStore` holds specs) so the registry stays decoupled from any one
  component's prop shape; each component validates and casts at its own render
  boundary.
- **Slot pattern C — descriptor slot paired with a dedicated registry.**
  `inlineComponentSlot` (`inline-content:components`) is a plain `defineSlot`
  carrying descriptors for enumeration only. The rendering lookup is a separate
  keyed slot owned by the renderer, because its value is React-typed.

### Algorithms

None — this package is pure type and slot declarations.

### Constraints

- No rendering happens here; resolving a `componentId` to a component is the
  renderer's job.
- A descriptor in the components slot does not imply a registered renderer; the
  two are contributed in tandem by the renderer fragment.

### Dependencies

`@statewalker/shared-slots` (`defineSlot`) and `@statewalker/shared-registry`
(init `cleanup`). Nothing else — deliberately minimal so the contract stays
framework-neutral.

## Related

- `@statewalker/inline.view.react` — the
  paired React renderer that owns the `inline-content:renderers` slot, the
  `<InlineContent>` resolver, and the built-in components (the `.core` ↔
  `.view.react` pair).

## License

MIT — see the monorepo root `LICENSE`.
