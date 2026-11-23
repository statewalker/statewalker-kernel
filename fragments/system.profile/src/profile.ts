import type { ActivationContext, KernelProfile } from "@statewalker/kernel.core";

/** The part of Web Storage (`localStorage`) the profile uses. */
export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * The user's profile on this device: JSON values under string keys, read and written at once.
 * A `KernelProfile` (the kernel keeps its fragment records in it); system.workbench keeps its
 * layouts per device mode under `workbench/layouts/<mode>`.
 */
export interface ProfileStore extends KernelProfile {
  /** The value under `key`, a copy; `undefined` when absent or unreadable. */
  get(key: string): unknown;
  /** Keep a copy of `value` (JSON) under `key`. Throws when JSON cannot hold it or storage refuses. */
  set(key: string, value: unknown): void;
  delete(key: string): void;
  /** The keys held, those starting with `prefix` when given. */
  keys(prefix?: string): string[];
}

/** A `StorageLike` in memory: the default, and for tests. */
export function createMemoryStorage(): StorageLike {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, String(value));
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

/**
 * The profile in `storage` (`localStorage` in a browser), each value as JSON under
 * `<prefix><key>`, so one storage holds several applications' profiles.
 */
export function createStorageProfile(storage: StorageLike, prefix = ""): ProfileStore {
  return {
    get(key) {
      const text = storage.getItem(prefix + key);
      if (text === null) return undefined;
      try {
        return JSON.parse(text);
      } catch {
        return undefined;
      }
    },
    set(key, value) {
      const text = JSON.stringify(value);
      if (text === undefined) throw new TypeError(`profile: ${key}: not a JSON value`);
      storage.setItem(prefix + key, text);
    },
    delete(key) {
      storage.removeItem(prefix + key);
    },
    keys(start = "") {
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(prefix + start)) keys.push(key.slice(prefix.length));
      }
      return keys;
    },
  };
}

export interface SystemProfileOptions {
  /** Where the profile is kept: `localStorage` in a browser; memory by default. */
  readonly storage?: StorageLike;
  /** The prefix of the profile's keys in `storage` (an application's id and `:`). */
  readonly prefix?: string;
}

/** The system.profile fragment's code: its store, and its client activator body. */
export interface SystemProfile {
  readonly store: ProfileStore;
  /** Activate the client aspect (no points yet). Returns the cleanup. */
  activate(context: ActivationContext): () => void;
}

export function createSystemProfile(options: SystemProfileOptions = {}): SystemProfile {
  const store = createStorageProfile(options.storage ?? createMemoryStorage(), options.prefix);
  return { store, activate: () => () => undefined };
}
