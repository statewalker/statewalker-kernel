import { getWorkspace } from "@statewalker/workspace.core";
import { DockManager } from "../internal/dock.manager.js";

/**
 * Attach the `DockHost` adapter to the workspace and register the
 * `dock:*` command handlers via a `DockManager`. Also installs the
 * bus-trace toggle (no-op unless `localStorage["chat-mini:bus-trace"]`
 * is `"1"`).
 *
 * The `<DockviewReact>` host (in the `dock-views` fragment) mounts
 * later inside the React tree; command calls that fire before then
 * are queued by `DockHost` and drain on `setApi`.
 *
 * Eviction policy: `dock:close-panel` removes the panel from
 * DockView and deletes the spec from `SpecStore` UNLESS
 * `meta.persistent === true`. Per the §3.1 / §5.5 contract.
 */
export default function initDock(ctx: Record<string, unknown>): () => Promise<void> {
  const workspace = getWorkspace(ctx);
  const manager = new DockManager({ workspace });
  return () => manager.close();
}
