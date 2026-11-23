import { type InlineComponentDescriptor, inlineComponentSlot } from "@statewalker/inline.core";
import { newRegistry } from "@statewalker/shared-registry";
import { Slots } from "@statewalker/shared-slots";
import { getWorkspace } from "@statewalker/workspace.core";
import { ActionButton } from "../internal/components/action-button.js";
import { DirectoryCard } from "../internal/components/directory-card.js";
import { FileCard } from "../internal/components/file-card.js";
import { LineChart } from "../internal/components/line-chart.js";
import { MetricCard } from "../internal/components/metric-card.js";
import {
  type InlineContentComponent,
  inlineContentRenderersSlot,
} from "./inline-content-registry.js";

const BUILTINS: ReadonlyArray<{
  descriptor: InlineComponentDescriptor;
  component: InlineContentComponent;
}> = [
  {
    descriptor: {
      id: "metric-card",
      label: "Metric Card",
      description: "Single-value KPI card with optional delta and trend.",
    },
    component: MetricCard as unknown as InlineContentComponent,
  },
  {
    descriptor: {
      id: "line-chart",
      label: "Line Chart",
      description: "Compact SVG line chart for a numeric series.",
    },
    component: LineChart as unknown as InlineContentComponent,
  },
  {
    descriptor: {
      id: "file-card",
      label: "File Card",
      description: "File reference; clicking fires files:visualize.",
    },
    component: FileCard as unknown as InlineContentComponent,
  },
  {
    descriptor: {
      id: "directory-card",
      label: "Directory Card",
      description: "Directory reference; clicking children fires files:visualize.",
    },
    component: DirectoryCard as unknown as InlineContentComponent,
  },
  {
    descriptor: {
      id: "action-button",
      label: "Action Button",
      description: "Fires an arbitrary command on click.",
    },
    component: ActionButton as unknown as InlineContentComponent,
  },
];

/**
 * Renderer-fragment init for `inline-content-react`. Pairs with
 * `@statewalker/inline-content` (logic).
 *
 * Registers each built-in inline component under its id in the
 * `inline-content:renderers` slot (rendering lookup) AND contributes
 * a descriptor to `inline-content:components` (discoverability).
 * Plug-in fragments register the same way — the chat surface
 * sees them indistinguishably from built-ins.
 */
export default function initInlineContentReact(ctx: Record<string, unknown>): () => Promise<void> {
  const [register, cleanup] = newRegistry();
  const workspace = getWorkspace(ctx);
  const slots = workspace.requireAdapter(Slots);

  for (const { descriptor, component } of BUILTINS) {
    register(slots.register(inlineContentRenderersSlot, descriptor.id, component));
    register(slots.provide(inlineComponentSlot, descriptor));
  }

  return cleanup;
}
