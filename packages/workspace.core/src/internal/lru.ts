/**
 * In-memory LRU cache.
 *
 * Entries are evicted when the cache exceeds `max` items or when an entry is older than
 * `maxAge` milliseconds. `dispose(key, value)` is called for every evicted/removed entry.
 */
export interface LruOptions<K = string, V = unknown> {
  /** Maximum number of entries kept; older entries are pruned past this. Default 100. */
  max?: number;
  /** Maximum entry age in milliseconds. Default one hour. */
  maxAge?: number;
  /** Called with each evicted or removed entry. */
  dispose?: (key: K, value: V) => void;
}

/** Public surface shared by {@link LRU} and the object returned by {@link bindLruMethods}. */
export interface LruCache<V = unknown, K = string> {
  readonly max: number;
  readonly maxAge: number;
  readonly size: number;
  dispose: (key: K, value: V) => void;
  get(key: K): V | undefined;
  set(key: K, value: V): void;
  del(key: K): boolean;
  keys(): K[];
  prune(): void;
  reset(): void;
  close(): void;
}

interface Slot<K, V> {
  key: K;
  stamp: number;
  value?: V;
}

export class LRU<V = unknown, K = string> implements LruCache<V, K> {
  readonly max: number;
  readonly maxAge: number;
  dispose: (key: K, value: V) => void;

  private index = new Map<K, Slot<K, V>>();
  private list: Slot<K, V>[] = [];

  constructor({ max = 100, maxAge = 1000 * 60 * 60, dispose = () => {} }: LruOptions<K, V> = {}) {
    this.max = max;
    this.maxAge = maxAge;
    this.dispose = dispose;
  }

  get size(): number {
    return this.list.length;
  }

  prune(): void {
    const now = this._now();
    while (this.list.length) {
      const oldest = this.list[0];
      if (!oldest) break;
      if (this.list.length <= this.max && now - oldest.stamp <= this.maxAge) break;
      this.list.shift();
      this.index.delete(oldest.key);
      this.dispose(oldest.key, oldest.value as V);
    }
  }

  set(key: K, value: V): void {
    let slot = this.refresh(key);
    if (!slot) {
      slot = { stamp: this._now(), key };
      this.index.set(key, slot);
      this.list.push(slot);
      this.list.sort(this._compareSlots);
    }
    slot.value = value;
    this.prune();
  }

  del(key: K): boolean {
    const slot = this.index.get(key);
    if (!slot) return false;
    const idx = this.list.indexOf(slot);
    if (idx >= 0) this.list.splice(idx, 1);
    this.index.delete(key);
    this.dispose(slot.key, slot.value as V);
    this.prune();
    return true;
  }

  get(key: K): V | undefined {
    this.prune();
    const slot = this.refresh(key);
    return slot ? slot.value : undefined;
  }

  keys(): K[] {
    this.prune();
    return this.list.map((slot) => slot.key);
  }

  reset(): void {
    const list = this.list;
    this.list = [];
    this.index = new Map();
    for (const slot of list) this.dispose(slot.key, slot.value as V);
  }

  close(): void {
    this.reset();
  }

  private refresh(key: K): Slot<K, V> | undefined {
    const slot = this.index.get(key);
    if (slot) {
      slot.stamp = this._now();
      this.list.sort(this._compareSlots);
    }
    return slot;
  }

  private _compareSlots = (a: Slot<K, V>, b: Slot<K, V>): number =>
    a.stamp > b.stamp ? 1 : a.stamp < b.stamp ? -1 : 0;

  private _now(): number {
    return Date.now();
  }
}

/**
 * Augment `target` with LRU cache methods backed by a fresh {@link LRU}. Used to turn a
 * plain function into a callable, self-caching memoizer (see {@link newCache}).
 */
export function bindLruMethods<T extends object, V = unknown, K = string>(
  target: T,
  options: LruOptions<K, V> = {},
): T & LruCache<V, K> {
  const lru = new LRU<V, K>(options);
  const out = target as T & LruCache<V, K>;
  out.get = (key) => lru.get(key);
  out.set = (key, value) => lru.set(key, value);
  out.del = (key) => lru.del(key);
  out.keys = () => lru.keys();
  out.prune = () => lru.prune();
  out.reset = () => lru.reset();
  out.close = () => lru.close();
  out.dispose = lru.dispose;
  Object.defineProperty(out, "size", { get: () => lru.size });
  Object.defineProperty(out, "max", { get: () => lru.max });
  Object.defineProperty(out, "maxAge", { get: () => lru.maxAge });
  return out;
}
