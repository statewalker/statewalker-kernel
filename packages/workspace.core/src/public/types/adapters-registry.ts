/** The three handle levels an adapter factory can target. */
export type AdapterLevel = "workspace" | "project" | "resource";

/**
 * Registry key type. Abstract classes (token classes) MUST be usable as keys —
 * hence `abstract new`. The constructor signature is unconstrained so tokens
 * from any package can be passed in.
 */
// biome-ignore lint/suspicious/noExplicitAny: token constructors are heterogeneous
export type AdapterCtor<T = unknown> = abstract new (...args: any[]) => T;

/** Concrete implementation shape — callable with `new` to produce an instance. */
// biome-ignore lint/suspicious/noExplicitAny: concrete ctor values are heterogeneous
export type ConcreteAdapterCtor<T = unknown> = new (...args: any[]) => T;

/** A factory for an adapter, given its host handle. MAY return `null` ("not applicable"). */
export type AdapterFactory<T = unknown, H = unknown> = (host: H) => T | null;

// biome-ignore lint/suspicious/noExplicitAny: registry keys are heterogeneous
type AnyKey = AdapterCtor<any>;
// biome-ignore lint/suspicious/noExplicitAny: impls are heterogeneous
type AnyImpl = ConcreteAdapterCtor<any> | AdapterFactory<any>;

/**
 * Level-aware store of adapter factories. A factory registered for a level is
 * resolved by every handle of that level when it has no handle-local
 * registration. Exposed by the `Workspace` so `Project`/`Resource` handles can
 * resolve their adapters from a single shared registry.
 */
export class AdaptersRegistry {
  private readonly maps: Record<AdapterLevel, Map<AnyKey, AnyImpl>> = {
    workspace: new Map(),
    project: new Map(),
    resource: new Map(),
  };

  /** Register an impl (concrete ctor or factory) for `type` at `level`. Returns an unregister fn. */
  register<T>(
    level: AdapterLevel,
    type: AdapterCtor<T>,
    // biome-ignore lint/suspicious/noExplicitAny: factory host is the level's handle type
    impl: ConcreteAdapterCtor<T> | AdapterFactory<T, any>,
  ): () => void {
    const map = this.maps[level];
    map.set(type, impl as AnyImpl);
    return () => {
      if (map.get(type) === (impl as AnyImpl)) map.delete(type);
    };
  }

  /** Look up the impl registered for `type` at `level`, if any. */
  getFactory(level: AdapterLevel, type: AnyKey): AnyImpl | undefined {
    return this.maps[level].get(type);
  }
}
