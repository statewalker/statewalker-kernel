import { describe, expect, it, vi } from "vitest";
import { sourceHook } from "../src/source-hooks.js";

// Mock fetch for tests
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);
vi.stubGlobal("document", {
  createElement: () => ({ textContent: "" }),
  head: { appendChild: () => {} },
});

function mockResponse(body: string, contentType = "text/plain") {
  return new Response(body, {
    headers: { "Content-Type": contentType },
  });
}

const noopDefaultHook = async (url: string, _opts: RequestInit, _parent: string) => ({
  type: "js" as const,
  source: `/* default: ${url} */`,
});

describe("sourceHook", () => {
  it("wraps CSS as a JS module", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse("body { color: red; }"));

    const result = await sourceHook("https://host/theme.css", {}, "", noopDefaultHook);

    expect(result.type).toBe("js");
    expect(result.source).toContain("export default");
    expect(result.source).toContain("body { color: red; }");
    expect(result.source).toContain("document.createElement");
  });

  it("wraps JSON as export default", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('{"key":"value"}'));

    const result = await sourceHook("https://host/config.json", {}, "", noopDefaultHook);

    expect(result.type).toBe("js");
    expect(result.source).toBe('export default {"key":"value"};');
  });

  it("compiles TypeScript via sucrase", async () => {
    const tsCode = "const x: number = 42;\nexport default x;";
    mockFetch.mockResolvedValueOnce(mockResponse(tsCode));

    const result = await sourceHook("https://host/module.ts", {}, "", noopDefaultHook);

    expect(result.type).toBe("js");
    expect(result.source).toContain("const x = 42");
    expect(result.source).not.toContain(": number");
  });

  it("compiles TSX with JSX transform", async () => {
    const tsxCode = "const App = () => <div>hello</div>;\nexport default App;";
    mockFetch.mockResolvedValueOnce(mockResponse(tsxCode));

    const result = await sourceHook("https://host/app.tsx", {}, "", noopDefaultHook);

    expect(result.type).toBe("js");
    expect(result.source).not.toContain("<div>");
    expect(result.source).toContain("jsxDEV");
  });

  it("passes through unknown extensions to default hook", async () => {
    const result = await sourceHook("https://host/module.js", {}, "", noopDefaultHook);

    expect(result.type).toBe("js");
    expect(result.source).toContain("default:");
  });

  it("strips ?v=N query from URL for extension detection", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse('{"hot":true}'));

    const result = await sourceHook("https://host/config.json?v=123", {}, "", noopDefaultHook);

    expect(result.type).toBe("js");
    expect(result.source).toContain("export default");
  });
});
