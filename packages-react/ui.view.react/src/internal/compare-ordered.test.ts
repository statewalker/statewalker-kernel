import { describe, expect, it } from "vitest";
import { compareByOrderAndId, type OrderedById } from "./compare-ordered.js";

// Pure comparator: lower `order` wins (default 100), ties broken by id.
describe("compareByOrderAndId", () => {
  it("orders by ascending `order`", () => {
    const items: OrderedById[] = [
      { id: "b", order: 30 },
      { id: "a", order: 10 },
      { id: "c", order: 20 },
    ];
    expect([...items].sort(compareByOrderAndId).map((i) => i.id)).toEqual(["a", "c", "b"]);
  });

  it("defaults a missing `order` to 100", () => {
    const withDefault: OrderedById = { id: "x" }; // order → 100
    const explicit50: OrderedById = { id: "y", order: 50 };
    const explicit150: OrderedById = { id: "z", order: 150 };
    expect(
      [explicit150, withDefault, explicit50].sort(compareByOrderAndId).map((i) => i.id),
    ).toEqual(["y", "x", "z"]);
  });

  it("breaks `order` ties lexicographically by id", () => {
    const items: OrderedById[] = [
      { id: "banana", order: 100 },
      { id: "apple", order: 100 },
      { id: "cherry", order: 100 },
    ];
    expect([...items].sort(compareByOrderAndId).map((i) => i.id)).toEqual([
      "apple",
      "banana",
      "cherry",
    ]);
  });

  it("returns a negative/positive/zero sign consistent with the contract", () => {
    expect(compareByOrderAndId({ id: "a", order: 1 }, { id: "b", order: 2 })).toBeLessThan(0);
    expect(compareByOrderAndId({ id: "b", order: 2 }, { id: "a", order: 1 })).toBeGreaterThan(0);
    // equal order + equal id → 0
    expect(compareByOrderAndId({ id: "a", order: 5 }, { id: "a", order: 5 })).toBe(0);
  });

  it("prefers `order` over id when they disagree", () => {
    // 'z' has lower order than 'a' → 'z' sorts first despite id order
    expect(
      [
        { id: "a", order: 200 },
        { id: "z", order: 1 },
      ]
        .sort(compareByOrderAndId)
        .map((i) => i.id),
    ).toEqual(["z", "a"]);
  });
});
