// The user's profile in this browser, until system.profile keeps it: the kernel's records
// (`fragments/<id>`, `migrations/<id>`) and the application's, as JSON in localStorage under one
// prefix. React-free.
import type { KernelProfile } from "@statewalker/kernel.core";

/** A `KernelProfile` that can also list its keys (the host restores the fragments it records). */
export interface ListableProfile extends KernelProfile {
  keys(): string[];
}

/** The profile in `storage`, every key under `prefix`. */
export function createStorageProfile(storage: Storage, prefix: string): ListableProfile {
  return {
    get(key) {
      const text = storage.getItem(prefix + key);
      return text === null ? undefined : JSON.parse(text);
    },
    set(key, value) {
      storage.setItem(prefix + key, JSON.stringify(value));
    },
    delete(key) {
      storage.removeItem(prefix + key);
    },
    keys() {
      const keys: string[] = [];
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key?.startsWith(prefix)) keys.push(key.slice(prefix.length));
      }
      return keys;
    },
  };
}
