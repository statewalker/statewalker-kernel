import { Settings } from "../public/types/settings.js";
import { SystemFiles } from "../public/types/system-files.js";
import type { Workspace } from "../public/types/workspace.js";
import { JsonPerKeyStore } from "./json-per-key-store.js";

/**
 * Default `Settings` impl. Same JSON-per-key shape as `FilesBackedSecrets`,
 * but under a sibling subtree (`settingsDir`) and without the lock/unlock
 * surface.
 */
export class FilesBackedSettings extends Settings {
  private readonly store: JsonPerKeyStore;

  constructor(workspace: Workspace, settingsDir: string) {
    super();
    const systemFiles = workspace.requireAdapter(SystemFiles).files;
    this.store = new JsonPerKeyStore(systemFiles, settingsDir);
  }

  get<T = unknown>(key: string): Promise<T | undefined> {
    return this.store.get<T>(key);
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

  close(): void {
    this.store.flushPendingNotifications();
  }
}
