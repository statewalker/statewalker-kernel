import { newAdapter } from "@statewalker/shared-adapters";
import { BaseClass } from "@statewalker/shared-baseclass";

/**
 * Serialized URL state — what gets written to / read from the URL hash.
 */
export interface UrlState {
  path: string;
  query: Record<string, string>;
}

/**
 * A reversible mapping between application state and the URL.
 * `serialize` builds an outgoing URL state from the in-memory model;
 * `deserialize` applies an incoming URL state back onto the model.
 */
export interface UrlSerializer {
  serialize(state: UrlState): UrlState;
  deserialize(state: UrlState): void;
}

/**
 * Navigation token — workspace-scoped bidirectional URL ↔ model state
 * synchronisation. Apps reach the workspace-scoped instance via
 * `workspace.requireAdapter(Navigation)`. Models register
 * `UrlSerializer`s; the browser binding (provided by
 * `@statewalker/platform-browser`) flushes the serialized state to
 * `location.hash` whenever `sync()` notifies, and feeds incoming
 * `hashchange` events back to all deserializers via `applyUrl()`.
 *
 * A directional lock prevents feedback loops: at any moment sync flows
 * in only one direction.
 *
 * Inlined into `platform-api` (was re-exported from `workbench-views`)
 * so the substrate can retire the legacy package — see the
 * `workbench-canonical-substrate` capability spec.
 */
export class Navigation extends BaseClass {
  #serializers: Set<UrlSerializer> = new Set();
  #syncing = false;

  register(serializer: UrlSerializer): () => void {
    this.#serializers.add(serializer);
    return () => {
      this.#serializers.delete(serializer);
    };
  }

  sync(): void {
    if (this.#syncing) return;
    this.#syncing = true;
    try {
      this.notify();
    } finally {
      this.#syncing = false;
    }
  }

  buildState(): UrlState {
    let state: UrlState = { path: "", query: {} };
    for (const s of this.#serializers) {
      state = s.serialize(state);
    }
    return state;
  }

  applyUrl(state: UrlState): void {
    if (this.#syncing) return;
    this.#syncing = true;
    try {
      for (const s of this.#serializers) {
        s.deserialize(state);
      }
    } finally {
      this.#syncing = false;
    }
  }

  get isSyncing(): boolean {
    return this.#syncing;
  }
}

export { Navigation as UrlStateView };

export const [getUrlStateView, setUrlStateView, removeUrlStateView] = newAdapter<Navigation>(
  "model:url-state",
  () => new Navigation(),
);
