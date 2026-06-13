import { Commands } from "@statewalker/shared-commands";
import { newRegistry } from "@statewalker/shared-registry";
import type { Workspace } from "@statewalker/workspace";
import { CloseSettingsCommand, OpenSettingsCommand } from "../public/commands.js";
import { Settings } from "../public/settings.adapter.js";

export interface SettingsManagerOptions {
  workspace: Workspace;
}

/**
 * Lifetime-scoped orchestrator for the settings fragment.
 * Registers default handlers for `runOpenSettings` /
 * `runCloseSettings`; both write to the `Settings` adapter so
 * React consumers re-render via `useSyncExternalStore` on
 * `BaseClass.onUpdate`.
 *
 * The dialog state is local UI — it does not depend on workspace
 * lifecycle, so this manager is one-shot (constructed at boot,
 * survives `onLoad`/`onUnload` cycles). Slot contributions to
 * `settings:tabs` arrive from other fragments' lifecycle managers
 * and are observed directly by the renderer fragment.
 */
export class SettingsManager {
  private readonly _cleanup: () => Promise<void>;

  constructor({ workspace }: SettingsManagerOptions) {
    const commands = workspace.requireAdapter(Commands);
    const settings = workspace.requireAdapter(Settings);

    const [register, cleanup] = newRegistry();
    this._cleanup = cleanup;

    register(
      commands.listen(OpenSettingsCommand, (command) => {
        settings._setOpen(true, command.payload?.tabId);
        command.resolve();
        return true;
      }),
    );
    register(
      commands.listen(CloseSettingsCommand, (command) => {
        settings._setOpen(false);
        command.resolve();
        return true;
      }),
    );
  }

  async close(): Promise<void> {
    await this._cleanup();
  }
}
