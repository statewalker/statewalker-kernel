import { type FilesApi, tryReadText, writeText } from "@statewalker/webrun-files";
import { SystemFiles, type Workspace } from "@statewalker/workspace.core";

/** Bare path under the SystemFiles root where the dock layout is persisted. */
const LAYOUT_FILE = "/dock-layout.json";
/** Legacy localStorage key the old DockHost serialized its layout under. */
const LEGACY_LOCALSTORAGE_KEY = "chat-mini:dock-layout";

/**
 * Workspace adapter that holds/loads/persists the dock-layout JSON at the bare
 * SystemFiles path `dock-layout.json`. Registered on the `Workspace` like
 * `SystemFiles`/`Secrets` and obtained via `workspace.requireAdapter(LayoutStore)`.
 *
 * It holds the layout JSON ONLY — it does NOT build panel specs (fragment-owned)
 * and does NOT apply the layout via `api.fromJSON` (DockHost-owned).
 *
 * `get` / `set` are synchronous over an in-memory snapshot. `connect()` runs on
 * workspace-connect (`onLoad`): it lazily reaches `SystemFiles.files` (which
 * throws before an FS is installed, hence lazy), does load-then-conditional-flush
 * (a present file is authoritative and is never overwritten; the in-memory layout
 * is flushed only when no file exists yet), runs a one-time localStorage
 * migration, and falls back to the default (empty) layout on a corrupt file —
 * never throwing or rejecting out of the connect path. `set` schedules a
 * coalesced (microtask + short debounce) and guarded (try/catch) async write.
 */
export class LayoutStore {
  private _layout: object | null = null;
  private _writeScheduled = false;
  private _writeTimer: ReturnType<typeof setTimeout> | null = null;
  /** In-flight `connect()` promise — single-flights concurrent/re-entrant connects. */
  private _connecting: Promise<void> | null = null;
  private _disposeOnLoad: (() => void) | null = null;

  constructor(private readonly workspace: Workspace) {
    // Self-register the restore on workspace-connect. The FIRST consumer to
    // resolve this adapter (a fragment's `requireAdapter` or `DockHost`'s
    // `getAdapter`) constructs it here — BEFORE that consumer registers its own
    // `onLoad` — so this connect-onLoad is inserted first and `Workspace.open()`
    // (which awaits each listener in insertion order) loads the file before any
    // fragment's synchronous `get()` pre-alloc reads it.
    this._disposeOnLoad = workspace.onLoad(() => this.connect());
  }

  /** Adapter teardown hook — drops the `onLoad` subscription. */
  close(): void {
    this._disposeOnLoad?.();
    this._disposeOnLoad = null;
  }

  /** Synchronous read of the in-memory layout; `null` until loaded or set. */
  get(): object | null {
    return this._layout;
  }

  /** Synchronous set of the in-memory layout; schedules a coalesced, guarded write. */
  set(layout: object | null): void {
    this._layout = layout;
    this._scheduleWrite();
  }

  /** Lazy — `SystemFiles` throws before an FS is installed, so only touch it on connect. */
  private get files(): FilesApi {
    return this.workspace.requireAdapter(SystemFiles).files;
  }

  /**
   * Load-then-conditional-flush on workspace-connect. Idempotent; never throws.
   *
   * Single-flighted: a concurrent/re-entrant call returns the in-flight promise
   * instead of running the load twice. The in-flight ref is cleared once the run
   * settles, so a later connect (e.g. a close→open re-connect) runs fresh.
   */
  connect(): Promise<void> {
    return (this._connecting ??= this._connect().finally(() => {
      this._connecting = null;
    }));
  }

  private async _connect(): Promise<void> {
    const files = this.files;
    let raw: string | undefined;
    try {
      raw = await tryReadText(files, LAYOUT_FILE);
    } catch (error) {
      console.warn("[layout-store] failed to read dock-layout.json", error);
      raw = undefined;
    }

    if (raw !== undefined) {
      // A file exists — it is authoritative. Parse it or fall back; never overwrite.
      try {
        this._layout = JSON.parse(raw) as object;
      } catch (error) {
        console.warn("[layout-store] corrupt dock-layout.json — using default layout", error);
        this._layout = null;
      }
      return;
    }

    // No file yet. One-time migration from a legacy localStorage value.
    const migrated = this._readLegacyLocalStorage();
    if (migrated !== null) {
      this._layout = migrated;
      await this._write(migrated);
      return;
    }

    // No file, no legacy value: flush the in-memory layout only if one is present.
    if (this._layout !== null) {
      await this._write(this._layout);
    }
  }

  private _readLegacyLocalStorage(): object | null {
    // The WHOLE read is guarded: a sandboxed iframe throws `SecurityError` on the
    // `globalThis.localStorage` property access, a storage-disabled browser
    // (Safari private mode) throws on `getItem`, and a corrupt value throws on
    // `JSON.parse`. Any of these falls through to the file/default — connect()
    // must never throw or reject.
    try {
      const ls = globalThis.localStorage;
      if (!ls) return null; // SSR/node — not an error.
      const raw = ls.getItem(LEGACY_LOCALSTORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as object;
    } catch {
      return null;
    }
  }

  private _scheduleWrite(): void {
    if (this._writeScheduled) return;
    this._writeScheduled = true;
    queueMicrotask(() => {
      // Debounce a hair past the microtask so a burst of synchronous sets in the
      // same tick collapses into a single write of the latest layout.
      if (this._writeTimer) clearTimeout(this._writeTimer);
      this._writeTimer = setTimeout(() => {
        this._writeScheduled = false;
        this._writeTimer = null;
        void this._flush();
      }, 0);
    });
  }

  private async _flush(): Promise<void> {
    if (this._layout === null) return;
    await this._write(this._layout);
  }

  private async _write(layout: object): Promise<void> {
    // Guarded: a failed write is logged, never an unhandled rejection or a crash.
    try {
      await writeText(this.files, LAYOUT_FILE, JSON.stringify(layout));
    } catch (error) {
      console.warn("[layout-store] failed to persist dock-layout.json", error);
    }
  }
}
