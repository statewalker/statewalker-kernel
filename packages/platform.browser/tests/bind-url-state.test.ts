import { describe, expect, it } from "vitest";
import { buildHash, parseHash } from "../src/bind-url-state.js";

describe("parseHash", () => {
  it("parses empty hash", () => {
    expect(parseHash("")).toEqual({ path: "", query: {} });
    expect(parseHash("#")).toEqual({ path: "", query: {} });
  });

  it("parses path only", () => {
    expect(parseHash("#/chat")).toEqual({ path: "/chat", query: {} });
  });

  it("parses path with query", () => {
    expect(parseHash("#/chat?id=abc&tab=main")).toEqual({
      path: "/chat",
      query: { id: "abc", tab: "main" },
    });
  });

  it("parses query without path", () => {
    expect(parseHash("#?chat=123")).toEqual({
      path: "",
      query: { chat: "123" },
    });
  });

  it("handles hash without # prefix", () => {
    expect(parseHash("/chat?id=1")).toEqual({
      path: "/chat",
      query: { id: "1" },
    });
  });
});

describe("buildHash", () => {
  it("builds hash with path only", () => {
    expect(buildHash({ path: "/chat", query: {} })).toBe("#/chat");
  });

  it("builds hash with path and query", () => {
    const hash = buildHash({ path: "/chat", query: { id: "abc" } });
    expect(hash).toBe("#/chat?id=abc");
  });

  it("builds hash with empty path and query", () => {
    expect(buildHash({ path: "", query: { chat: "123" } })).toBe("#?chat=123");
  });

  it("builds hash with empty path and empty query", () => {
    expect(buildHash({ path: "", query: {} })).toBe("#");
  });
});

describe("parseHash ↔ buildHash round-trip", () => {
  it("round-trips path with query", () => {
    const original = { path: "/chat", query: { id: "abc", tab: "main" } };
    const hash = buildHash(original);
    const parsed = parseHash(hash);
    expect(parsed.path).toBe(original.path);
    expect(parsed.query.id).toBe("abc");
    expect(parsed.query.tab).toBe("main");
  });
});
