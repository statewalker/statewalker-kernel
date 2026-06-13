import type { WorkspaceAdapter } from "./workspace.js";

/**
 * Abstract adapter token for per-workspace user settings. Shares the
 * JSON-per-key storage shape with `Secrets` but lives under a sibling subtree
 * and does NOT carry the lock/unlock surface — settings are not expected to
 * be sensitive at rest.
 */
export abstract class Settings implements WorkspaceAdapter {
  abstract get<T = unknown>(key: string): Promise<T | undefined>;
  abstract set(key: string, value: unknown): Promise<void>;
  abstract delete(key: string): Promise<boolean>;
  abstract list(): Promise<string[]>;
  abstract onUpdate(cb: (changedKeys: string[]) => void): () => void;

  init?(): void | Promise<void>;
  close?(): void | Promise<void>;
}
