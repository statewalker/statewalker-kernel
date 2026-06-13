import { BaseClass } from "@statewalker/shared-baseclass";
import type {
  AdapterCtor,
  AdapterFactory,
  AdapterLevel,
  AdaptersRegistry,
  ConcreteAdapterCtor,
} from "./adapters-registry.js";

/**
 * Optional teardown hook an adapter MAY expose. Called by `setAdapter` when an
 * existing instance is being explicitly replaced.
 */
export interface AdaptableAdapter {
  close?(): void | Promise<void>;
}

// biome-ignore lint/suspicious/noExplicitAny: registry keys are heterogeneous
type AnyKey = AdapterCtor<any>;
// biome-ignore lint/suspicious/noExplicitAny: concrete ctor values are heterogeneous
type AnyCtor = ConcreteAdapterCtor<any>;
// biome-ignore lint/suspicious/noExplicitAny: factory matches any adapter/host
type AnyFactory = AdapterFactory<any, any>;

/**
 * Observable, class-keyed adapter host. `Workspace`, `Project`, and `Resource`
 * all extend this. Adapter resolution is purely by constructor identity:
 *
 *   local cache → handle-local registration (`setAdapter`) →
 *   level-scoped factory in the shared `AdaptersRegistry` → concrete self-host → null
 *
 * Constructed adapter **instances are cached strongly** per handle (stable
 * identity); a factory MAY return `null` ("not applicable"), which is cached so
 * the factory runs once. Weak-ref caching lives at the value level inside
 * adapters (see `references.ts`), never here.
 */
export abstract class Adaptable extends BaseClass {
  /** The level used to resolve factories from the registry. */
  protected abstract get adapterLevel(): AdapterLevel;
  /** The shared registry every handle consults (owned by the root `Workspace`). */
  protected abstract get adaptersRegistry(): AdaptersRegistry;

  private readonly _registrations = new Map<AnyKey, AnyCtor | AnyFactory>();
  private readonly _instances = new Map<AnyKey, unknown>();
  private readonly _instantiating = new Set<AnyKey>();

  setAdapter<T>(type: ConcreteAdapterCtor<T>): this;
  setAdapter<T, C extends T>(
    type: AdapterCtor<T>,
    impl: ConcreteAdapterCtor<C> | ((host: this) => C | null),
  ): this;
  setAdapter(type: AnyKey, impl?: AnyCtor | AnyFactory): this {
    const implementation = impl ?? (type as unknown as AnyCtor);
    if (this._instances.has(type)) {
      const existing = this._instances.get(type);
      if (existing) void this._closeInstance(existing);
      this._instances.delete(type);
    }
    this._registrations.set(type, implementation);
    return this;
  }

  getAdapter<T>(type: AdapterCtor<T>): T | null {
    if (this._instances.has(type)) return this._instances.get(type) as T | null;

    // Resolve the impl: handle-local registration, then a level-scoped factory
    // from the shared registry, then self-host when the token is itself a class.
    const ctor = type as unknown as AnyCtor;
    const impl =
      this._registrations.get(type) ??
      this.adaptersRegistry?.getFactory(this.adapterLevel, type) ??
      (isClass(ctor) ? ctor : null);
    if (!impl) return null;

    if (this._instantiating.has(type)) {
      throw new Error(`Adapter cycle detected while constructing ${describe(type)}`);
    }
    this._instantiating.add(type);
    try {
      const instance = (isClass(impl) ? new impl(this) : impl(this)) as T | null;
      this._instances.set(type, instance);
      return instance;
    } finally {
      this._instantiating.delete(type);
    }
  }

  requireAdapter<T>(type: AdapterCtor<T>): T {
    const instance = this.getAdapter(type);
    if (instance === null || instance === undefined) {
      throw new Error(`No adapter registered for ${describe(type)}`);
    }
    return instance;
  }

  private async _closeInstance(adapter: unknown): Promise<void> {
    try {
      await (adapter as AdaptableAdapter).close?.();
    } catch (err) {
      console.error("[adaptable] adapter.close (re-register) threw:", err);
    }
  }
}

function isClass(value: AnyCtor | AnyFactory): value is AnyCtor {
  return (
    typeof value === "function" && typeof value.prototype === "object" && value.prototype !== null
  );
}

function describe(type: AdapterCtor): string {
  return (type as { name?: string }).name || "<anonymous adapter>";
}
