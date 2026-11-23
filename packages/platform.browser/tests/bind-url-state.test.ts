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

describe("paths that need escaping", () => {
  const paths = ["/a b", "/café", "/a?b", "/a#b", "/50%", "/a/b c/d"];

  for (const path of paths) {
    it(`round-trips ${JSON.stringify(path)} with a query`, () => {
      const state = { path, query: { views: "x" } };
      expect(parseHash(buildHash(state))).toEqual(state);
    });
  }

  it("escapes what the hash cannot carry, segment by segment", () => {
    expect(buildHash({ path: "/a b/c?d#e", query: {} })).toBe("#/a%20b/c%3Fd%23e");
  });

  it("keeps plain paths as they were written", () => {
    expect(buildHash({ path: "/docs/a.md:12@x", query: {} })).toBe("#/docs/a.md:12@x");
    expect(parseHash("#/docs/a.md:12@x")).toEqual({ path: "/docs/a.md:12@x", query: {} });
  });

  it("reads a path the browser percent-encoded", () => {
    expect(parseHash("#/caf%C3%A9?views=x")).toEqual({ path: "/café", query: { views: "x" } });
  });

  it("keeps a segment that is not valid percent-encoding as it is", () => {
    expect(parseHash("#/100%zz")).toEqual({ path: "/100%zz", query: {} });
  });
});
