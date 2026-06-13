import { Secrets } from "../public/types/secrets.js";
import { SystemFiles } from "../public/types/system-files.js";
import type { Workspace } from "../public/types/workspace.js";
import { JsonPerKeyStore } from "./json-per-key-store.js";

/**
 * Default `Secrets` impl. Stores each secret as one JSON file per key under
 * `{systemFiles}/{secretsDir}/{encodedKey}.json`. `onUpdate` notifications
 * coalesce across a microtask.
 */
export class FilesBackedSecrets extends Secrets {
  private readonly store: JsonPerKeyStore;

  readonly isLocked = false;

  constructor(workspace: Workspace, secretsDir: string) {
    super();
    const systemFiles = workspace.requireAdapter(SystemFiles).files;
    this.store = new JsonPerKeyStore(systemFiles, secretsDir);
  }

  get(key: string): Promise<unknown | undefined> {
    return this.store.get(key);
  }

  set(key: string, value: unknown): Promise<void> {
    return this.store.set(key, value);
  }

  delete(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  list(): Promise<string[]> {
    return this.store.list();
  }

  onUpdate(cb: (changedKeys: string[]) => void): () => void {
    return this.store.onUpdate(cb);
  }

  override close(): void {
    this.store.flushPendingNotifications();
  }
}
