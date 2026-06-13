import { BaseClass } from "@statewalker/shared-baseclass";

/**
 * Workspace-adapter holding the settings dialog's open / active-tab
 * state. Mutated only by `SettingsManager` (in response to
 * `runOpenSettings` / `runCloseSettings` commands); React consumers
 * read via `useAdapter(Settings)` + `useSyncExternalStore` on
 * `BaseClass.onUpdate`.
 */
export class Settings extends BaseClass {
  /** Type-only declaration for `WorkspaceAdapter` weak-shape compat. */
  declare close?: () => void | Promise<void>;

  private _isOpen = false;
  private _activeTabId: string | null = null;

  get isOpen(): boolean {
    return this._isOpen;
  }

  get activeTabId(): string | null {
    return this._activeTabId;
  }

  /** Manager-only: open the dialog (optionally focusing a tab). */
  _setOpen(open: boolean, tabId?: string): void {
    let changed = false;
    if (this._isOpen !== open) {
      this._isOpen = open;
      changed = true;
    }
    if (tabId !== undefined && this._activeTabId !== tabId) {
      this._activeTabId = tabId;
      changed = true;
    }
    if (changed) this.notify();
  }

  /** React-side action: switch which tab is active. */
  setActiveTab(tabId: string): void {
    if (this._activeTabId === tabId) return;
    this._activeTabId = tabId;
    this.notify();
  }
}
