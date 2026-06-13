import { type FilesApi, readText } from "@statewalker/webrun-files";

const textEncoder = new TextEncoder();

function encodeKey(key: string): string {
  return encodeURIComponent(key);
}

function decodeKey(encoded: string): string {
  return decodeURIComponent(encoded);
}

/**
 * Shared backend for JSON-per-key adapter implementations (`FilesBackedSecrets`,
 * `FilesBackedSettings`). Each key lives at `{dir}/{encodedKey}.json`.
 *
 * Observer notifications coalesce within a microtask, so a burst of writes
 * surfaces as a single `onUpdate` call carrying the union of changed keys.
 */
export class JsonPerKeyStore {
  private readonly files: FilesApi;
  private readonly dir: string;
  private readonly listeners = new Set<(changedKeys: string[]) => void>();
  private pendingChanges = new Set<string>();
  private flushScheduled = false;

  constructor(files: FilesApi, dir: string) {
    this.files = files;
    this.dir = trimSlashes(dir);
  }

  private path(key: string): string {
    return this.dir ? `/${this.dir}/${encodeKey(key)}.json` : `/${encodeKey(key)}.json`;
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const path = this.path(key);
    if (!(await this.files.exists(path))) return undefined;
    const text = await readText(this.files, path);
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    const path = this.path(key);
    const bytes = textEncoder.encode(JSON.stringify(value));
    await this.files.write(path, [bytes]);
    this.scheduleNotify(key);
  }

  async delete(key: string): Promise<boolean> {
    const path = this.path(key);
    const removed = await this.files.remove(path);
    if (removed) this.scheduleNotify(key);
    return removed;
  }

  async list(): Promise<string[]> {
    const dir = this.dir ? `/${this.dir}` : "/";
    const result: string[] = [];
    try {
      for await (const entry of this.files.list(dir)) {
        if (entry.kind !== "file") continue;
        if (!entry.path.endsWith(".json")) continue;
        const filename = entry.path.split("/").pop() ?? "";
        const baseName = filename.slice(0, -".json".length);
        if (!baseName) continue;
        try {
          result.push(decodeKey(baseName));
        } catch {
          // Skip entries whose names don't decode cleanly.
        }
      }
    } catch {
      // Directory may not exist yet.
    }
    return result;
  }

  onUpdate(cb: (changedKeys: string[]) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  flushPendingNotifications(): void {
    if (!this.flushScheduled) return;
    this.flushScheduled = false;
    const keys = Array.from(this.pendingChanges);
    this.pendingChanges = new Set();
    if (keys.length === 0) return;
    for (const listener of this.listeners) {
      listener(keys);
    }
  }

  private scheduleNotify(key: string): void {
    this.pendingChanges.add(key);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      if (!this.flushScheduled) return;
      this.flushScheduled = false;
      const keys = Array.from(this.pendingChanges);
      this.pendingChanges = new Set();
      for (const listener of this.listeners) {
        listener(keys);
      }
    });
  }
}

function trimSlashes(path: string): string {
  let out = path;
  while (out.startsWith("/")) out = out.slice(1);
  while (out.endsWith("/")) out = out.slice(0, -1);
  return out;
}
