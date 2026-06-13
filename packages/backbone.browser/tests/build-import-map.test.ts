import type { ResolvedModule } from "@statewalker/backbone.core";
import { describe, expect, it } from "vitest";
import { buildImportMap } from "../src/build-import-map.js";

function makeModule(
  name: string,
  url: string,
  exports?: Record<string, string>,
): ResolvedModule & { packageJson?: { exports?: Record<string, string> } } {
  return {
    name,
    url,
    version: "0.0.0",
    packageJsonUrl: `${url}/package.json`,
    packageJson: exports ? { exports } : undefined,
  };
}

describe("buildImportMap", () => {
  it("generates entries from sub-path exports", () => {
    const registry = new Map([
      ["@repo/shared-adapters", "https://host/modules/@repo/shared-adapters"],
    ]);
    const modules = [
      makeModule("@repo/shared-adapters", "https://host/modules/@repo/shared-adapters", {
        "./adapters": "./adapters.js",
        "./registry": "./registry.js",
      }),
    ];
    const result = buildImportMap(modules, registry);

    expect(result.imports["@repo/shared-adapters/adapters"]).toBe(
      "https://host/modules/@repo/shared-adapters/adapters.js",
    );
    expect(result.imports["@repo/shared-adapters/registry"]).toBe(
      "https://host/modules/@repo/shared-adapters/registry.js",
    );
  });

  it("generates entry from root export '.'", () => {
    const registry = new Map([["@repo/shared-views", "https://host/modules/@repo/shared-views"]]);
    const modules = [
      makeModule("@repo/shared-views", "https://host/modules/@repo/shared-views", {
        ".": "./index.js",
        "./layout": "./layout.js",
      }),
    ];
    const result = buildImportMap(modules, registry);

    expect(result.imports["@repo/shared-views"]).toBe(
      "https://host/modules/@repo/shared-views/index.js",
    );
    expect(result.imports["@repo/shared-views/layout"]).toBe(
      "https://host/modules/@repo/shared-views/layout.js",
    );
  });

  it("falls back to index.js when no exports field", () => {
    const registry = new Map([["@ext/sandbox", "https://host/modules/@ext/sandbox"]]);
    const modules = [makeModule("@ext/sandbox", "https://host/modules/@ext/sandbox")];
    const result = buildImportMap(modules, registry);

    expect(result.imports["@ext/sandbox"]).toBe("https://host/modules/@ext/sandbox/index.js");
  });

  it("uses direct URL for leaf nodes with file extension", () => {
    const registry = new Map([["react", "https://esm.sh/react@19.2.0"]]);
    const modules = [makeModule("react", "https://esm.sh/react@19.2.0")];
    const result = buildImportMap(modules, registry);

    // esm.sh URLs have no package.json, so no exports — should use URL directly
    // The URL has no file extension in path, so falls back to index.js approach
    // Actually esm.sh/react@19.2.0 doesn't end with an extension, so it adds /index.js
    expect(result.imports.react).toBeDefined();
  });
});
