import type { WorkspaceAdapter } from "./workspace.js";

/**
 * Abstract adapter token for per-workspace secrets (API keys, tokens). The
 * default implementation writes one JSON file per key under the system
 * subtree; alternative impls MAY encrypt at rest via `lock()` / `unlock()`.
 *
 * `onUpdate` fires with a deduplicated list of changed keys once per tick
 * (writes may be coalesced at the implementation's discretion).
 */
export abstract class Secrets implements WorkspaceAdapter {
  abstract get(key: string): Promise<unknown | undefined>;
  abstract set(key: string, value: unknown): Promise<void>;
  abstract delete(key: string): Promise<boolean>;
  abstract list(): Promise<string[]>;
  abstract onUpdate(cb: (changedKeys: string[]) => void): () => void;

  readonly isLocked?: boolean;
  lock?(): void;
  unlock?(password: string): Promise<boolean>;

  init?(): void | Promise<void>;
  close?(): void | Promise<void>;
}
