import { describe, expect, it } from "vitest";
import { Adaptable } from "../public/types/adaptable.js";
import { AdaptersRegistry } from "../public/types/adapters-registry.js";

/** Minimal concrete Adaptable at the "resource" level for testing the base. */
class TestResource extends Adaptable {
  constructor(
    private readonly _registry: AdaptersRegistry,
    readonly name: string,
  ) {
    super();
  }
  protected get adapterLevel() {
    return "resource" as const;
  }
  protected get adaptersRegistry() {
    return this._registry;
  }
}

class Reader {
  constructor(readonly host: TestResource) {}
}

describe("AdaptersRegistry + Adaptable — level-scoped factories", () => {
  it("instantiates a registered resource factory per host", () => {
    const registry = new AdaptersRegistry();
    registry.register("resource", Reader, (h) => new Reader(h as TestResource));

    const a = new TestResource(registry, "a");
    const b = new TestResource(registry, "b");

    const ra = a.getAdapter(Reader);
    expect(ra).toBeInstanceOf(Reader);
    expect(ra?.host).toBe(a);
    expect(a.getAdapter(Reader)).toBe(ra); // strong per-host cache
    expect(b.getAdapter(Reader)?.host).toBe(b); // distinct per host
  });

  it("a factory returning null yields null and is cached (factory runs once)", () => {
    const registry = new AdaptersRegistry();
    let calls = 0;
    // Plain arrow factory (no prototype) so it is resolved as a factory, not a ctor.
    registry.register("resource", Reader, () => {
      calls += 1;
      return null;
    });

    const r = new TestResource(registry, "x");
    expect(r.getAdapter(Reader)).toBeNull();
    expect(r.getAdapter(Reader)).toBeNull();
    expect(calls).toBe(1);
    expect(() => r.requireAdapter(Reader)).toThrow();
  });

  it("resolves the factory for its own level, not another level's", () => {
    class Tag {
      constructor(readonly origin: string) {}
    }
    const registry = new AdaptersRegistry();
    registry.register("resource", Tag, () => new Tag("resource"));
    registry.register("project", Tag, () => new Tag("project"));

    const r = new TestResource(registry, "x");
    expect(r.getAdapter(Tag)?.origin).toBe("resource");
  });
});
