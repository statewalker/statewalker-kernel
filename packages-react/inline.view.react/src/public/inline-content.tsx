import type { InlineContentSpec } from "@statewalker/inline.core";
import { Slots } from "@statewalker/shared-slots";
import { useAdapter, useKeyedSlot } from "@statewalker/ui.view.react";
import type { ReactElement } from "react";
import { inlineContentRenderersSlot } from "./inline-content-registry.js";

/**
 * Resolves `spec.componentId` against the application's
 * `inline-content:renderers` slot and renders the resulting component
 * with the spec's props. Subscribes via `useKeyedSlot` so a
 * late-registered component (plug-in path) renders without a remount.
 *
 * Unknown component ids render a small inline error chip — the
 * agent's structured output is the trust boundary here, so an
 * unknown id should be visible (not silently swallowed).
 */
export function InlineContent({ spec }: { spec: InlineContentSpec }): ReactElement {
  const slots = useAdapter(Slots);
  const registry = useKeyedSlot(slots, inlineContentRenderersSlot);
  const Component = registry.get(spec.componentId);

  if (!Component) {
    return (
      <span className="rounded-sm bg-destructive/10 px-2 py-0.5 font-mono text-xs text-destructive">
        Unknown inline component: {spec.componentId}
      </span>
    );
  }
  return <Component props={spec.props} />;
}
