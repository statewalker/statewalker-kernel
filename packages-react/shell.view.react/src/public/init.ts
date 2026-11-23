import { newRegistry } from "@statewalker/shared-registry";
import { Slots } from "@statewalker/shared-slots";
import { coreViewsSlot, SHELL_ROOT_VIEW_KEY, type ViewComponent } from "@statewalker/ui.view.react";
import { getWorkspace } from "@statewalker/workspace.core";
import { MainShell } from "../internal/main-shell.js";

/**
 * Renderer-fragment init for dock-views. Registers `MainShell` — the
 * top-level application shell — into `core:views` under
 * `SHELL_ROOT_VIEW_KEY`. `core-react`'s `<App/>` renders whatever is
 * registered there once the workspace is `ready`, so `core-react` never
 * imports the shell directly (the `core-react` ↔ `dock-react` edge stays
 * one-way: `dock → core`).
 *
 * Mounting `MainShell` is also what binds the DockviewApi to the dock
 * fragment's `DockHost` adapter (its `<DockViewHost>` calls `setApi`
 * on `onReady`).
 */
export default function initDockViews(ctx: Record<string, unknown>): () => void {
  const [register, cleanup] = newRegistry();
  const workspace = getWorkspace(ctx);
  const slots = workspace.requireAdapter(Slots);
  register(slots.register(coreViewsSlot, SHELL_ROOT_VIEW_KEY, MainShell as ViewComponent));
  return cleanup;
}
