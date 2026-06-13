import { describe, expect, it, vi } from "vitest";
import { newReference } from "./references.js";

describe("newReference — lazy memoized value", () => {
  it("computes lazily and memoizes while the value is alive", () => {
    const create = vi.fn(() => ({ v: 1 }));
    const ref = newReference(create);
    expect(create).not.toHaveBeenCalled();

    const a = ref();
    const b = ref();
    expect(a).toBe(b);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("reset() forces a recompute on next dereference", () => {
    let n = 0;
    const ref = newReference(() => ({ v: ++n }));
    expect(ref().v).toBe(1);
    expect(ref().v).toBe(1);

    ref.reset();
    expect(ref().v).toBe(2);
  });
});

describe("newReference — dependency tracking", () => {
  it("recomputes when an upstream dependency is reset", () => {
    let upstreamN = 0;
    const upstream = newReference(() => ({ v: ++upstreamN }));

    const downstreamCreate = vi.fn((u: { v: number }) => ({ doubled: u.v * 2 }));
    const downstream = newReference([upstream], (u) => downstreamCreate(u as { v: number }));

    expect(downstream().doubled).toBe(2);
    expect(downstream().doubled).toBe(2);
    expect(downstreamCreate).toHaveBeenCalledTimes(1);

    // Invalidate the upstream value; the downstream must recompute from the new one.
    upstream.reset();
    expect(downstream().doubled).toBe(4);
    expect(downstreamCreate).toHaveBeenCalledTimes(2);
  });
});
