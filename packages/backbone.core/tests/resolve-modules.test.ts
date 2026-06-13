import { describe, expect, it } from "vitest";
import { ModuleResolver, type ModuleResolverOptions } from "../src/resolve-modules.js";

/**
 * Build a mock resolver from a virtual package registry.
 *
 * Each entry maps a package name to its metadata:
 *   { entry: relative entry path, version, deps: { name: "workspace:*" } }
 */
function createMockResolver(
  packages: Record<
    string,
    {
      entry?: string;
      version?: string;
      dependencies?: Record<string, string>;
    }
  >,
): ModuleResolver {
  const prefix = "file:///packages/";

  function extractPackageName(url: string): string {
    if (!url.startsWith(prefix)) throw new Error(`Bad URL: ${url}`);
    const rest = url.slice(prefix.length);
    // Find the known package whose name is a prefix of `rest`
    for (const name of Object.keys(packages)) {
      if (rest.startsWith(`${name}/`)) return name;
    }
    throw new Error(`Unknown package in URL: ${url}`);
  }

  const options: ModuleResolverOptions = {
    async resolve(_baseUrl: string, moduleId: string): Promise<string> {
      const pkg = packages[moduleId];
      if (!pkg) throw new Error(`Package not found: ${moduleId}`);
      const entry = pkg.entry ?? "src/index.ts";
      return `${prefix}${moduleId}/${entry}`;
    },

    async findPackageJson(moduleUrl: string): Promise<string> {
      const name = extractPackageName(moduleUrl);
      return `${prefix}${name}/package.json`;
    },

    async loadPackageJson(packageJsonUrl: string): Promise<Record<string, unknown>> {
      const name = extractPackageName(packageJsonUrl);
      const pkg = packages[name];
      if (!pkg) throw new Error(`Package not found: ${name}`);
      return {
        name,
        version: pkg.version ?? "0.0.0",
        dependencies: pkg.dependencies ?? {},
      };
    },
  };

  return new ModuleResolver(options);
}

describe("ModuleResolver", () => {
  it("returns empty array for empty input", async () => {
    const resolver = createMockResolver({});
    const result = await resolver.resolveModules("file:///app/", []);
    expect(result).toEqual([]);
  });

  it("resolves a single module with no deps", async () => {
    const resolver = createMockResolver({
      shared: { version: "1.0.0" },
    });
    const result = await resolver.resolveModules("file:///app/", ["shared"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("shared");
    expect(result[0].url).toBe("file:///packages/shared/src/index.ts");
    expect(result[0].version).toBe("1.0.0");
    expect(result[0].packageJsonUrl).toBe("file:///packages/shared/package.json");
  });

  it("orders dependencies before dependents", async () => {
    const resolver = createMockResolver({
      shared: {},
      logger: { dependencies: { shared: "workspace:*" } },
    });
    const result = await resolver.resolveModules("file:///app/", ["logger"]);
    const names = result.map((m) => m.name);

    expect(names).toContain("shared");
    expect(names).toContain("logger");
    expect(names.indexOf("shared")).toBeLessThan(names.indexOf("logger"));
  });

  it("handles a diamond dependency graph", async () => {
    const resolver = createMockResolver({
      shared: {},
      logger: { dependencies: { shared: "workspace:*" } },
      pg: { dependencies: { shared: "workspace:*" } },
      auth: { dependencies: { logger: "workspace:*", pg: "workspace:*" } },
    });
    const result = await resolver.resolveModules("file:///app/", ["auth"]);
    const names = result.map((m) => m.name);

    expect(names[0]).toBe("shared");
    expect(names[names.length - 1]).toBe("auth");
    expect(names.indexOf("logger")).toBeLessThan(names.indexOf("auth"));
    expect(names.indexOf("pg")).toBeLessThan(names.indexOf("auth"));
  });

  it("deduplicates modules listed explicitly and as transitive deps", async () => {
    const resolver = createMockResolver({
      shared: {},
      logger: { dependencies: { shared: "workspace:*" } },
    });
    const result = await resolver.resolveModules("file:///app/", ["shared", "logger"]);
    const names = result.map((m) => m.name);

    expect(names.filter((n) => n === "shared")).toHaveLength(1);
    expect(names.indexOf("shared")).toBeLessThan(names.indexOf("logger"));
  });

  it("skips non-workspace dependencies", async () => {
    const resolver = createMockResolver({
      app: {
        dependencies: {
          shared: "workspace:*",
          lodash: "^4.17.0",
          express: "~5.0.0",
        },
      },
      shared: {},
    });
    const result = await resolver.resolveModules("file:///app/", ["app"]);
    const names = result.map((m) => m.name);

    expect(names).toEqual(["shared", "app"]);
  });

  it("includes version from package.json", async () => {
    const resolver = createMockResolver({
      shared: { version: "2.1.0" },
      logger: {
        version: "1.3.0",
        dependencies: { shared: "workspace:*" },
      },
    });
    const result = await resolver.resolveModules("file:///app/", ["logger"]);

    expect(result.find((m) => m.name === "shared")?.version).toBe("2.1.0");
    expect(result.find((m) => m.name === "logger")?.version).toBe("1.3.0");
  });

  it("treats unreadable package.json as leaf node", async () => {
    const resolver = new ModuleResolver({
      async resolve(_baseUrl, moduleId) {
        return `file:///packages/${moduleId}/index.ts`;
      },
      async findPackageJson(moduleUrl) {
        return moduleUrl.replace(/\/[^/]+$/, "/package.json");
      },
      async loadPackageJson() {
        throw new Error("cannot read");
      },
    });

    const result = await resolver.resolveModules("file:///app/", ["broken"]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("broken");
    expect(result[0].version).toBe("");
  });

  it("passes the parent package.json URL as baseUrl for transitive deps", async () => {
    const resolveCalls: Array<[string, string]> = [];

    const resolver = new ModuleResolver({
      async resolve(baseUrl, moduleId) {
        resolveCalls.push([baseUrl, moduleId]);
        return `file:///packages/${moduleId}/src/index.ts`;
      },
      async findPackageJson(moduleUrl) {
        // Extract first path segment after /packages/ as package name
        const match = moduleUrl.match(/^file:\/\/\/packages\/([^/]+)\//);
        return `file:///packages/${match?.[1]}/package.json`;
      },
      async loadPackageJson(packageJsonUrl) {
        if (packageJsonUrl.includes("/logger/")) {
          return {
            name: "logger",
            version: "1.0.0",
            dependencies: { shared: "workspace:*" },
          };
        }
        return { name: "shared", version: "1.0.0", dependencies: {} };
      },
    });

    await resolver.resolveModules("file:///app/package.json", ["logger"]);

    // First call: logger resolved from the app's base URL
    expect(resolveCalls[0]).toEqual(["file:///app/package.json", "logger"]);
    // Second call: shared resolved from logger's package.json URL
    expect(resolveCalls[1]).toEqual(["file:///packages/logger/package.json", "shared"]);
  });

  it("preserves input order for independent modules", async () => {
    const resolver = createMockResolver({
      logger: {},
      http: {},
      sandbox: {},
    });
    const result = await resolver.resolveModules("file:///app/", ["logger", "http", "sandbox"]);
    const names = result.map((m) => m.name);
    expect(names).toEqual(["logger", "http", "sandbox"]);
  });

  it("respects input order unless dependencies require reordering", async () => {
    const resolver = createMockResolver({
      shared: {},
      logger: { dependencies: { shared: "workspace:*" } },
      http: { dependencies: { logger: "workspace:*" } },
      sandbox: {},
    });
    // User lists sandbox before http, but http depends on logger depends on shared
    const result = await resolver.resolveModules("file:///app/", ["logger", "http", "sandbox"]);
    const names = result.map((m) => m.name);

    // shared must come before logger (dependency), logger before http (dependency)
    expect(names.indexOf("shared")).toBeLessThan(names.indexOf("logger"));
    expect(names.indexOf("logger")).toBeLessThan(names.indexOf("http"));
    // sandbox is independent — should respect input order (after http)
    expect(names.indexOf("sandbox")).toBeGreaterThan(names.indexOf("http"));
  });

  it("uses custom entry points from package.json", async () => {
    const resolver = createMockResolver({
      mylib: { entry: "dist/main.js" },
    });
    const result = await resolver.resolveModules("file:///app/", ["mylib"]);
    expect(result[0].url).toBe("file:///packages/mylib/dist/main.js");
  });
});
