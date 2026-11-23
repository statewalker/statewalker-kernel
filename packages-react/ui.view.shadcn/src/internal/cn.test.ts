import { describe, expect, it } from "vitest";
import { cn } from "./cn.js";

// Real unit tests for the `cn` class-merge helper (clsx + tailwind-merge).
// These assert the composition contract, not a tautology: each case has a
// non-obvious expected string that a naive `join(" ")` would get wrong.
describe("cn", () => {
  it("joins plain string args with single spaces", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("drops falsy conditional args (false / null / undefined / empty)", () => {
    // clsx must strip these; a plain join would leave gaps / literal false.
    expect(cn("a", false && "x", null, undefined, "", "b")).toBe("a b");
  });

  it("resolves conflicting tailwind utilities keeping the last (twMerge)", () => {
    // The whole reason cn exists over clsx: later class wins on conflict.
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
  });

  it("keeps non-conflicting tailwind utilities side by side", () => {
    expect(cn("px-2", "py-4")).toBe("px-2 py-4");
  });

  it("supports clsx object / array syntax with truthy filtering", () => {
    expect(cn(["a", { b: true, c: false }], "d")).toBe("a b d");
  });

  it("later conditional override wins over an earlier base class", () => {
    const active = true;
    // base 'bg-red-500' overridden by conditional 'bg-blue-500'
    expect(cn("bg-red-500", active && "bg-blue-500")).toBe("bg-blue-500");
  });

  it("returns an empty string when all inputs are falsy", () => {
    expect(cn(false, null, undefined, "")).toBe("");
  });
});
