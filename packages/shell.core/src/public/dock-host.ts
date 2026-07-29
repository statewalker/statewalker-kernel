import { LayoutStore } from "@statewalker/render.core";
import type { Workspace } from "@statewalker/workspace.core";
import type { DockviewApi } from "dockview-react";
import type { ShowDockPanelPayload } from "./commands.js";

/** The dockview serialized-layout shape, as accepted by `api.fromJSON`. */
type DockLayout = Parameters<DockviewApi["fromJSON"]>[0];

interface PendingPanel {
  options: ShowDockPanelPayload;
  /** Resolves after the panel is actually opened (after the api comes online). */
  resolve: () => void;
}

/**
 * Workspace adapter holding the active `DockviewApi` reference plus a
 * queue of `runShowDockPanel` calls that fired before the
 * `<DockviewReact>` host mounted.
 *
 * The dock fragment's `init` runs during boot, so the command
 * handlers it registers are reachable immediately. The
 * `<DockviewReact>` component, however, only mounts inside the
 * React tree (via the renderer fragment's DockViewHost). Any
 * `runShowDockPanel` call between those two events is queued; the
 * queue drains synchronously on `setApi`. After the api is set,
 * calls are dispatched directly.
 *
 * Layout persistence is file-backed via the `LayoutStore` workspace
 * adapter (`render.core`), which owns the `dock-layout.json` file.
 * DockHost never touches `localStorage`: it reads/writes the layout
 * only through `LayoutStore.get()` / `set()`, and re-applies the saved
 * layout on `workspace.onLoad` (see `_onWorkspaceLoad`).
 */
export class DockHost {
  private _api: DockviewApi | null = null;
  private _pending: PendingPanel[] = [];
  private _layoutSaveScheduled = false;
  private _disposeApiListeners: (() => void) | null = null;
  private _disposeOnLoad: (() => void) | null = null;
  private _activeListeners = new Set<(panelId: string | undefined) => void>();
  private _activePanelId: string | undefined = undefined;
  private _layoutListeners = new Set<() => void>();
  /**
   * Snapshot of the previous api's layout, captured synchronously in
   * `detach()`. Used by the next `setApi()` so panels added between
   * the previous mount and the persist-microtask are not lost when
   * React.StrictMode / HMR remounts `<DockviewReact>`.
   */
  private _inMemoryLayout: object | null = null;

  declare init?: () => void | Promise<void>;

  /**
   * @param workspace The host workspace. Optional so pure command/queue
   *   mechanics can be unit-tested without a workspace; when present,
   *   DockHost resolves the `LayoutStore` adapter through it and restores
   *   the saved layout on `onLoad`.
   */
  constructor(private readonly workspace?: Workspace) {
    if (workspace) {
      this._disposeOnLoad = workspace.onLoad(() => this._onWorkspaceLoad());
    }
  }

  close(): void {
    this._disposeOnLoad?.();
    this._disposeOnLoad = null;
  }

  private _layoutStore(): LayoutStore | null {
    return this.workspace ? this.workspace.getAdapter(LayoutStore) : null;
  }

  setApi(api: DockviewApi): void {
    if (this._api === api) return;
    this._disposeApiListeners?.();
    this._api = api;
    // Restoration order: prefer the in-memory snapshot from a recent
    // detach (covers StrictMode / HMR remount where the persisted
    // layout is older than what was on the previous api). Fall back
    // to the LayoutStore's in-memory layout, which is `null` on cold
    // mount (the file has not connected yet) — so cold load renders the
    // DEFAULT layout and the saved one re-applies later, on `onLoad`.
    if (this._inMemoryLayout) {
      try {
        api.fromJSON(this._inMemoryLayout as DockLayout);
      } catch (error) {
        console.warn("[chat-mini:dock] failed to restore in-memory layout", error);
        this._restoreLayout();
      }
      this._inMemoryLayout = null;
    } else {
      this._restoreLayout();
    }
    const queue = this._pending;
    this._pending = [];
    for (const item of queue) {
      this._addOrFocus(item.options);
      item.resolve();
    }
    const onLayoutChange = api.onDidLayoutChange(() => {
      this._scheduleLayoutSave();
      for (const cb of this._layoutListeners) cb();
    });
    this._setActivePanelId(api.activePanel?.id);
    const onActivePanel = api.onDidActivePanelChange((panel) => {
      this._setActivePanelId(panel?.id);
    });
    this._disposeApiListeners = () => {
      onLayoutChange.dispose();
      onActivePanel.dispose();
    };
  }

  detach(): void {
    if (this._api) {
      try {
        this._inMemoryLayout = this._api.toJSON();
      } catch (error) {
        console.warn("[chat-mini:dock] failed to snapshot layout on detach", error);
        this._inMemoryLayout = null;
      }
    }
    this._disposeApiListeners?.();
    this._disposeApiListeners = null;
    this._api = null;
    this._setActivePanelId(undefined);
  }

  /** Currently active panel id, or `undefined` if no panel/api. */
  getActivePanelId(): string | undefined {
    return this._activePanelId;
  }

  /**
   * Subscribe to active-panel changes. Returns a disposer. The
   * callback is NOT invoked immediately — read `getActivePanelId()`
   * once at subscribe time if you need an initial snapshot.
   */
  onActivePanelChange(cb: (panelId: string | undefined) => void): () => void {
    this._activeListeners.add(cb);
    return () => {
      this._activeListeners.delete(cb);
    };
  }

  private _setActivePanelId(id: string | undefined): void {
    if (this._activePanelId === id) return;
    this._activePanelId = id;
    for (const cb of this._activeListeners) {
      cb(id);
    }
  }

  /**
   * Either dispatch immediately if the api is online, or queue the
   * panel until `setApi` is called. Returns a promise that resolves
   * once the panel is actually open (mirroring what callers expect
   * from the command's promise contract).
   */
  showOrFocus(options: ShowDockPanelPayload): Promise<void> {
    if (this._api) {
      this._addOrFocus(options);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this._pending.push({ options, resolve });
    });
  }

  closePanel(panelId: string): void {
    if (!this._api) {
      this._pending = this._pending.filter((p) => p.options.panelId !== panelId);
      return;
    }
    const panel = this._api.getPanel(panelId);
    if (panel) this._api.removePanel(panel);
  }

  focusPanel(panelId: string): void {
    if (!this._api) return;
    const panel = this._api.getPanel(panelId);
    if (panel) panel.focus();
  }

  setPanelTitle(panelId: string, title: string): void {
    if (!this._api) return;
    const panel = this._api.getPanel(panelId);
    panel?.api.setTitle(title);
  }

  /** Snapshot of currently open panel ids (empty if no api attached). */
  getPanelIds(): readonly string[] {
    if (!this._api) return [];
    return this._api.panels.map((p) => p.id);
  }

  /**
   * Subscribe to layout changes (panel add/remove/move/focus). The
   * callback fires after every dock mutation; consumers can call
   * `getPanelIds()` to read the new snapshot. Returns a disposer.
   */
  onLayoutChange(cb: () => void): () => void {
    this._layoutListeners.add(cb);
    return () => {
      this._layoutListeners.delete(cb);
    };
  }

  /**
   * Test seam: read the active api or null if not yet attached.
   */
  _getApi(): DockviewApi | null {
    return this._api;
  }

  /**
   * Test seam: peek at the queue length so tests can verify
   * pre-mount calls were buffered.
   */
  _pendingCount(): number {
    return this._pending.length;
  }

  private _addOrFocus(options: ShowDockPanelPayload): void {
    if (!this._api) return;
    const existing = this._api.getPanel(options.panelId);
    if (existing) {
      if (options.activate ?? true) existing.focus();
      return;
    }
    // Reference-panel resolution: if a referencePanelId is supplied
    // AND that panel is currently open, anchor the new panel to it
    // (using `position` as the direction, default `"within"` when no
    // direction was given). This is what lets file viewers always
    // open in the main file-explorer's group regardless of which
    // panel had focus when the user clicked.
    const referencePanel = options.referencePanelId
      ? (this._api.getPanel(options.referencePanelId) ?? undefined)
      : undefined;
    const direction = options.position ?? (referencePanel ? "within" : undefined);
    this._api.addPanel({
      id: options.panelId,
      component: "json",
      title: options.title ?? options.panelId,
      params: { specId: options.specId },
      position: direction
        ? referencePanel
          ? { direction, referencePanel }
          : { direction }
        : undefined,
      inactive: options.activate === false,
    });
  }

  private _scheduleLayoutSave(): void {
    if (this._layoutSaveScheduled) return;
    this._layoutSaveScheduled = true;
    queueMicrotask(() => {
      this._layoutSaveScheduled = false;
      this._persistLayout();
    });
  }

  private _persistLayout(): void {
    if (!this._api) return;
    try {
      this._layoutStore()?.set(this._api.toJSON());
    } catch (error) {
      console.warn("[chat-mini:dock] failed to persist layout", error);
    }
  }

  private _restoreLayout(): void {
    if (!this._api) return;
    try {
      const layout = this._layoutStore()?.get();
      if (!layout) return;
      this._api.fromJSON(layout as DockLayout);
    } catch (error) {
      console.warn("[chat-mini:dock] failed to restore layout", error);
    }
  }

  /**
   * On workspace-connect, re-apply the saved layout the `LayoutStore`
   * loaded from `dock-layout.json`.
   *
   * The apply is deferred to a MACROTASK, not applied inline, so every
   * panel fragment's own synchronous `onLoad` pre-alloc (which registers
   * its `SpecStore` entries from the same adapter-held layout) completes
   * FIRST — otherwise a restored panel would render `PanelMissing`.
   *
   * A macrotask (not a `queueMicrotask`) is required: `Workspace.open()`
   * awaits each `onLoad` listener in turn, which drains the microtask
   * queue BETWEEN listeners. A microtask-deferred apply would therefore
   * run before a fragment whose `onLoad` was registered AFTER DockHost's.
   * A macrotask runs only after the whole awaited `onLoad` loop settles,
   * so all fragment pre-allocs are guaranteed done regardless of the
   * (insertion-order, non-guaranteed) registration order.
   */
  private _onWorkspaceLoad(): void {
    setTimeout(() => this._applyPersistedLayout(), 0);
  }

  private _applyPersistedLayout(): void {
    if (!this._api) return;
    const layout = this._layoutStore()?.get();
    if (!layout) return;
    try {
      this._api.fromJSON(layout as DockLayout);
    } catch (error) {
      console.warn("[chat-mini:dock] failed to apply restored layout", error);
    }
  }
}
