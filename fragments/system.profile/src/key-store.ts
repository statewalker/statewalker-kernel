/**
 * Where the vault keeps a remembered data key on this device: a non-extractable `CryptoKey`,
 * stored as itself (IndexedDB keeps structured clones), never as bytes.
 */
export interface VaultKeyStore {
  get(name: string): Promise<CryptoKey | undefined>;
  set(name: string, key: CryptoKey): Promise<void>;
  delete(name: string): Promise<void>;
}

/** A key store in memory: the default (nothing survives a reload), and for tests. */
export function createMemoryKeyStore(): VaultKeyStore & { readonly size: number } {
  const keys = new Map<string, CryptoKey>();
  return {
    get size() {
      return keys.size;
    },
    get: async (name) => keys.get(name),
    set: async (name, key) => {
      keys.set(name, key);
    },
    delete: async (name) => {
      keys.delete(name);
    },
  };
}

/** One IndexedDB database `name` with one object store, `keys`. */
export function createIndexedDbKeyStore(name: string): VaultKeyStore {
  let db: Promise<IDBDatabase> | undefined;
  const open = () => {
    db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("keys");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return db;
  };
  async function run<R>(
    mode: IDBTransactionMode,
    op: (store: IDBObjectStore) => IDBRequest<R>,
  ): Promise<R> {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction("keys", mode);
      const request = op(transaction.objectStore("keys"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
  return {
    async get(key) {
      const value = await run("readonly", (s) => s.get(key));
      return value instanceof CryptoKey ? value : undefined;
    },
    async set(key, value) {
      await run("readwrite", (s) => s.put(value, key));
    },
    async delete(key) {
      await run("readwrite", (s) => s.delete(key));
    },
  };
}
