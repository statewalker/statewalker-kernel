import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadShellConfig } from "../src/shell-config.js";

// Mock DOM
const mockGetElementById = vi.fn();
vi.stubGlobal("document", { getElementById: mockGetElementById });
vi.stubGlobal("location", { search: "" });

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockGetElementById.mockReturnValue(null);
  mockFetch.mockReset();
  (globalThis as Record<string, unknown>).location = { search: "" };
});

describe("loadShellConfig", () => {
  it("returns defaults when no config sources present", async () => {
    const config = await loadShellConfig({
      roots: ["@ext/sandbox"],
      modules: { react: "https://esm.sh/react" },
    });

    expect(config.roots).toEqual(["@ext/sandbox"]);
    expect(config.modules.react).toBe("https://esm.sh/react");
  });

  it("reads embedded config from script element", async () => {
    mockGetElementById.mockReturnValue({
      textContent: JSON.stringify({
        roots: ["@ext/explorer"],
        modules: { "@repo/shared-adapters": "/m/shared" },
      }),
    });

    const config = await loadShellConfig();
    expect(config.roots).toEqual(["@ext/explorer"]);
    expect(config.modules["@repo/shared-adapters"]).toBe("/m/shared");
  });

  it("URL ?root= params override roots", async () => {
    (globalThis as Record<string, unknown>).location = {
      search: "?root=@ext/a&root=@ext/b",
    };
    mockGetElementById.mockReturnValue({
      textContent: JSON.stringify({ roots: ["@ext/old"] }),
    });

    const config = await loadShellConfig();
    expect(config.roots).toEqual(["@ext/a", "@ext/b"]);
  });

  it("URL ?module= params add to modules", async () => {
    (globalThis as Record<string, unknown>).location = {
      search: "?module=@ext/custom:https://cdn.example.com/custom",
    };

    const config = await loadShellConfig({ roots: [], modules: {} });
    expect(config.modules["@ext/custom"]).toBe("https://cdn.example.com/custom");
  });

  it("merges fetched config over defaults", async () => {
    (globalThis as Record<string, unknown>).location = {
      search: "?config=https://host/config.json",
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        roots: ["@ext/fetched"],
        modules: { "@repo/shared-adapters": "/fetched/shared" },
      }),
    });

    const config = await loadShellConfig({
      roots: ["@ext/default"],
      modules: { react: "https://esm.sh/react" },
    });

    expect(config.roots).toEqual(["@ext/fetched"]);
    expect(config.modules["@repo/shared-adapters"]).toBe("/fetched/shared");
    expect(config.modules.react).toBe("https://esm.sh/react");
  });
});
