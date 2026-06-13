import { SpecStore } from "@statewalker/render.core";
import { Commands } from "@statewalker/shared-commands";
import { newRegistry } from "@statewalker/shared-registry";
import { Slots } from "@statewalker/shared-slots";
import type { Workspace } from "@statewalker/workspace.core";
import {
  ClosePanelCommand,
  FocusPanelCommand,
  SetPanelTitleCommand,
  ShowDockPanelCommand,
} from "../public/commands.js";
import { DockHost } from "../public/dock-host.js";
import { installBusTrace } from "./bus-trace.js";

export interface DockManagerOptions {
  workspace: Workspace;
}

/**
 * Orchestrator for the dock fragment. Owns the four `dock:*` command
 * handlers and the bus-trace toggle. Constructed once per
 * fragment-init; cleaned up via `close()`.
 *
 * Re-entrant lifecycle (ADR 0001) is added in Wave 3 alongside the
 * SystemFiles-backed layout migration; today the manager is one-shot
 * because the workspace is never `open()`ed in the current codebase.
 */
export class DockManager {
  private readonly commands: Commands;
  private readonly slots: Slots;
  private readonly dockHost: DockHost;
  private readonly store: SpecStore;
  private readonly _register: (cleanup: () => void) => () => void;
  private readonly _cleanup: () => Promise<void>;

  constructor({ workspace }: DockManagerOptions) {
    [this._register, this._cleanup] = newRegistry();
    this.commands = workspace.requireAdapter(Commands);
    this.slots = workspace.requireAdapter(Slots);
    this.dockHost = workspace.requireAdapter(DockHost);
    this.store = workspace.requireAdapter(SpecStore);

    this._wireHandlers();
  }

  private _wireHandlers(): void {
    this._register(installBusTrace(this.commands, this.slots));

    this._register(
      this.commands.listen(ShowDockPanelCommand, (cmd) => {
        this.dockHost
          .showOrFocus(cmd.payload)
          .then(() => cmd.resolve())
          .catch((error) => cmd.reject(error));
        return true;
      }),
    );

    this._register(
      this.commands.listen(ClosePanelCommand, (cmd) => {
        const { panelId } = cmd.payload;
        const api = this.dockHost._getApi();
        const panel = api?.getPanel(panelId);
        const specId = (panel?.params as { specId?: string } | undefined)?.specId;
        this.dockHost.closePanel(panelId);
        if (specId) {
          const record = this.store.get(specId);
          const stillReferenced =
            api?.panels.some(
              (p) => p.id !== panelId && (p.params as { specId?: string })?.specId === specId,
            ) ?? false;
          if (record && record.meta.persistent !== true && !stillReferenced) {
            this.store.delete(specId);
          }
        }
        cmd.resolve();
        return true;
      }),
    );

    this._register(
      this.commands.listen(FocusPanelCommand, (cmd) => {
        this.dockHost.focusPanel(cmd.payload.panelId);
        cmd.resolve();
        return true;
      }),
    );

    this._register(
      this.commands.listen(SetPanelTitleCommand, (cmd) => {
        this.dockHost.setPanelTitle(cmd.payload.panelId, cmd.payload.title);
        cmd.resolve();
        return true;
      }),
    );

    this._register(() => this.dockHost.detach());
  }

  async close(): Promise<void> {
    await this._cleanup();
  }
}
