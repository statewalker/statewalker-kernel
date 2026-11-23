import { newRegistry } from "@statewalker/shared-registry";
import { Slots } from "@statewalker/shared-slots";
import { dockOverlaysSlot } from "@statewalker/shell.core";
import { coreViewsSlot, type ViewComponent } from "@statewalker/ui.view.react";
import { getWorkspace } from "@statewalker/workspace.core";
import { SettingsButton } from "../internal/settings-button.js";
import { SettingsDialog } from "../internal/settings-dialog.js";

const VIEW_KEY_BUTTON = "settings:button";
const VIEW_KEY_DIALOG = "settings:dialog";

/**
 * Renderer-fragment init for `settings-react`. Registers the settings
 * button and dialog views into `core:views` and contributes the dialog
 * to `dock:overlays`. The button view is registered for callers that
 * still want a standalone trigger; the canonical app shell composes
 * Settings into the System menu instead of pinning a top-level button,
 * so this fragment no longer contributes to `dock:header-items`.
 */
export default function initSettingsReact(ctx: Record<string, unknown>): () => Promise<void> {
  const [register, cleanup] = newRegistry();
  const workspace = getWorkspace(ctx);
  const slots = workspace.requireAdapter(Slots);

  register(
    slots.register(coreViewsSlot, VIEW_KEY_BUTTON, SettingsButton as unknown as ViewComponent),
  );
  register(
    slots.register(coreViewsSlot, VIEW_KEY_DIALOG, SettingsDialog as unknown as ViewComponent),
  );
  register(
    slots.provide(dockOverlaysSlot, {
      id: "settings:dialog",
      viewKey: VIEW_KEY_DIALOG,
    }),
  );

  return cleanup;
}
