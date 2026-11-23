# @statewalker/inline.view.react

## What it is

React rendering for inline content: small components that a message or
document embeds by id, such as a metric card or a chart. It provides
`<InlineContent spec>`, which looks up a component by `spec.componentId` and
renders it with `spec.props`, the `inline-content:renderers` slot that holds
those components, and five built-in components: `metric-card`, `line-chart`,
`file-card`, `directory-card`, `action-button`.

## Why it exists

`@statewalker/inline.core` defines the spec type (`InlineContentSpec`) and the
`inline-content:components` slot, where components are listed by id and label
for discovery, with no React. The slot that holds the actual React components
must be typed with React, so it lives here. The fragment registers each
built-in in both slots; plug-in components register the same way and are
rendered exactly like built-ins.

## How to use

```sh
pnpm add @statewalker/inline.view.react
```

Peer dependencies: `react` and `react-dom` (`>=18`).

| Import | Provides |
| --- | --- |
| `@statewalker/inline.view.react` | `InlineContent`, `inlineContentRenderersSlot`, `InlineContentComponent`; default export is the fragment init |
| `@statewalker/inline.view.react/fragment` | Default export: `init(ctx)` that registers the five built-ins; returns a cleanup function |
| `@statewalker/inline.view.react/styles` | Tailwind v4 `@source` globs |

```ts
import "@statewalker/inline.view.react/styles";
import initInlineView from "@statewalker/inline.view.react/fragment";

const cleanup = initInlineView(ctx);
```

## Examples

### Render a spec

```tsx
import type { InlineContentSpec } from "@statewalker/inline.core";
import { InlineContent } from "@statewalker/inline.view.react";

const spec: InlineContentSpec = {
  componentId: "line-chart",
  props: { values: [3, 5, 4, 8, 6], startLabel: "Jan", endLabel: "May" },
};

<InlineContent spec={spec} />;
```

### Register a plug-in component

```tsx
import { inlineComponentSlot } from "@statewalker/inline.core";
import { type InlineContentComponent, inlineContentRenderersSlot } from "@statewalker/inline.view.react";
import { Slots } from "@statewalker/shared-slots";

const Greeting: InlineContentComponent = ({ props }) => <b>{String((props as { name: string }).name)}</b>;

const slots = workspace.requireAdapter(Slots);
slots.register(inlineContentRenderersSlot, "greeting", Greeting);
slots.provide(inlineComponentSlot, { id: "greeting", label: "Greeting" });
```

### Built-in components

| `componentId` | `props` |
| --- | --- |
| `metric-card` | `{ label: string, value: string \| number, delta?: string, trend?: "positive" \| "negative" }` |
| `line-chart` | `{ values: number[], startLabel?: string, endLabel?: string, height?: number }` |
| `file-card` | `{ uri: string, name?: string, description?: string }`; a click calls `files:visualize` |
| `directory-card` | `{ uri: string, name?: string, entries?: { name, kind: "file" \| "directory" }[] }`; without `entries` it loads one level with `files:load-directory`; a row click calls `files:visualize` |
| `action-button` | `{ label: string, command: string, payload?: unknown, variant?: "default" \| "primary" \| "destructive" }`; a click calls the command named `command` with `payload` |

## Internals

### Bad input is shown, not hidden

Specs often come from model output, so ids and props cannot be trusted.

- Unknown id: `<InlineContent>` renders `Unknown inline component: <id>`.
- Props of the wrong shape: the component renders `<Name>: invalid props`
  (for example `LineChart: invalid props`).

### `action-button` calls any command by name

The button builds a command declaration from the `command` string at click
time. A command with no listener does nothing and reports no error. Because
the command name comes from the spec, any registered command can be triggered
by content that reaches `<InlineContent>`.

### Components added later still render

`<InlineContent>` reads the renderers slot with `useKeyedSlot`, so a component
registered after the spec is on screen replaces the "Unknown inline component"
chip without a remount.

### Other details

- `line-chart` draws an SVG `<polyline>` scaled between the min and max values; no chart library.
- `directory-card` shows one level. Sub-folder rows call `files:visualize`
  instead of expanding.

### Dependencies

- `@statewalker/inline.core` — `InlineContentSpec`, `inlineComponentSlot`.
- `@statewalker/mime.core` — `VisualizeFileCommand`.
- `@statewalker/workspace.core` — `LoadDirectoryCommand`, `getWorkspace`.
- `@statewalker/ui.view.react` — hooks.
- `@statewalker/shared-commands`, `@statewalker/shared-slots`, `@statewalker/shared-registry` — command bus and slots.

## License

MIT
