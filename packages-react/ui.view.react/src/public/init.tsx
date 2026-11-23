import { getWorkspace } from "@statewalker/workspace.core";
import { createRoot, type Root } from "react-dom/client";
import { AppRoot } from "../internal/app-root.js";
import { getQueryClient } from "../internal/query-client-ctx.js";

/**
 * Renderer-fragment init for `core-react`. Owns the React mount path:
 * calls `createRoot(document.getElementById('app')!).render(<AppRoot/>)`
 * exactly once per fragment activation. The mount happens
 * synchronously; by the time the React tree commits, every other
 * fragment registered after `core-react` has finished its own `init`
 * (renderer fragments register after logic fragments, per main.tsx
 * boot order).
 *
 * Cleanup unmounts the React root so re-entrant `onLoad` /
 * `onUnload` cycles do not leak DOM.
 *
 * The `core:views` keyed slot is declared in `extension-points.ts`;
 * consumers reach it via the `coreViewsSlot` declaration plus the
 * workspace's `Slots` adapter — no eager adapter instantiation here.
 */
export default function initCoreReact(ctx: Record<string, unknown>): () => void {
  const workspace = getWorkspace(ctx);
  const queryClient = getQueryClient(ctx);

  let root: Root | null = null;
  const container = document.getElementById("app");
  if (container) {
    root = createRoot(container);
    root.render(<AppRoot workspace={workspace} queryClient={queryClient} />);
  }

  return () => {
    root?.unmount();
  };
}
