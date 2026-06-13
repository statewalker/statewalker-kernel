import { BaseClass } from "@statewalker/shared-baseclass";

/**
 * Discriminated union describing the FS-Access shell state machine
 * (per ADR 0004). The adapter starts in `loading`, performs
 * silent-restore against IndexedDB, then transitions to one of:
 *
 *   - `unsupported` — browser lacks `window.showDirectoryPicker`
 *   - `empty` — no persisted handle; user must pick a folder
 *   - `needs-permission` — handle exists but `queryPermission`
 *     returned `prompt`; a user gesture is required to reconnect
 *   - `ready` — handle adopted, `runChangeWorkspace` has fired,
 *     workspace is open and labeled
 */
export type WorkspaceShellState =
  | { status: "loading" }
  | { status: "unsupported"; reason: string }
  | { status: "empty" }
  | { status: "needs-permission"; label: string }
  | { status: "ready"; label: string };

/**
 * Single source of truth for the FS-Access shell state, consumed by
 * the React tree via `useAdapterValue(WorkspaceShellAdapter, …)`.
 * Constructed and registered by `workspace-bridge`'s manager during
 * `init` (not gated on `onLoad` — silent restore needs to start
 * before the first `open()`).
 */
export class WorkspaceShellAdapter extends BaseClass {
  private _state: WorkspaceShellState = { status: "loading" };

  getState(): WorkspaceShellState {
    return this._state;
  }

  _setState(state: WorkspaceShellState): void {
    this._state = state;
    this.notify();
  }
}
