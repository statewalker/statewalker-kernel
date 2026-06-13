import type { Spec, SpecCreateInput, SpecPatch, SpecRecord } from "./types.js";

/**
 * Workspace adapter holding json-render specs by id. Layout JSON
 * persists `params: { specId }` strings; this store holds the live
 * spec keyed by that id. JsonPanel subscribes via `observe` so
 * patches re-render the panel without DockView serialization.
 *
 * Stable-reference contract: `get(id)` caches the wrapper object;
 * the same reference is returned across calls until a `create` /
 * `patch` / `delete` mutation for that id occurs. Required so React
 * `useSyncExternalStore` consumers don't loop.
 *
 * Eviction is the dock fragment's concern, not this store's — see
 * `chat-mini-spec-store` spec, "Eviction policy on panel close".
 */
export class SpecStore {
  private readonly _records = new Map<string, SpecRecord>();
  private readonly _watchers = new Map<string, Set<() => void>>();

  declare init?: () => void | Promise<void>;
  declare close?: () => void | Promise<void>;

  /**
   * Add a new spec under the given (or generated) id. Throws if a
   * caller-supplied id is already present. Returns the id.
   */
  create(input: SpecCreateInput): string {
    const id = input.id ?? `spec:${crypto.randomUUID()}`;
    if (this._records.has(id)) {
      throw new Error(`SpecStore: spec id "${id}" already exists`);
    }
    this._records.set(id, {
      catalogId: input.catalogId,
      spec: input.spec,
      meta: input.meta ?? {},
    });
    return id;
  }

  /**
   * Read the spec record for `id`. The returned reference is stable
   * across calls until a mutation for `id`. `null` for unknown ids.
   */
  get(id: string): SpecRecord | null {
    return this._records.get(id) ?? null;
  }

  /**
   * Replace whichever fields are supplied on the existing record and
   * notify observers. v1 patch shape: full replace per provided
   * field (no JSON-Patch / delta forms). Throws for unknown ids.
   */
  patch(id: string, patch: SpecPatch): void {
    const existing = this._records.get(id);
    if (!existing) {
      throw new Error(`SpecStore: cannot patch unknown spec id "${id}"`);
    }
    const next: SpecRecord = {
      catalogId: patch.catalogId ?? existing.catalogId,
      spec: "spec" in patch ? (patch.spec as Spec) : existing.spec,
      meta: patch.meta ?? existing.meta,
    };
    this._records.set(id, next);
    this._notify(id);
  }

  /**
   * Subscribe to mutations for `id`. The callback is invoked on
   * `patch` and `delete` for that id (not at registration time).
   * Returns a disposer.
   */
  observe(id: string, cb: () => void): () => void {
    let watchers = this._watchers.get(id);
    if (!watchers) {
      watchers = new Set();
      this._watchers.set(id, watchers);
    }
    watchers.add(cb);
    return () => {
      const ws = this._watchers.get(id);
      if (!ws) return;
      ws.delete(cb);
      if (ws.size === 0) this._watchers.delete(id);
    };
  }

  delete(id: string): void {
    if (!this._records.has(id)) return;
    this._records.delete(id);
    this._notify(id);
  }

  private _notify(id: string): void {
    const watchers = this._watchers.get(id);
    if (!watchers) return;
    for (const cb of watchers) {
      try {
        cb();
      } catch (error) {
        console.error(error);
      }
    }
  }
}
