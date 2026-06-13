import { ModuleResolver } from "@statewalker/backbone.core";

/**
 * Creates a ModuleResolver that fetches package.json over HTTP.
 *
 * @param registry Maps module names to their base URLs (where package.json can be fetched).
 *   For leaf nodes (react, zod), the URL IS the final module URL — no package.json fetch.
 */
export function createBrowserResolver(registry: Map<string, string>): ModuleResolver {
  return new ModuleResolver({
    async resolve(_baseUrl: string, moduleId: string): Promise<string> {
      const baseUrl = registry.get(moduleId);
      if (!baseUrl) {
        throw new Error(`Module "${moduleId}" not found in registry`);
      }
      return baseUrl;
    },

    async findPackageJson(moduleUrl: string): Promise<string> {
      // If the URL already ends with a file extension, it's a leaf node (e.g., esm.sh URL)
      // Strip to directory and append package.json
      const base = moduleUrl.endsWith("/") ? moduleUrl : `${moduleUrl}/`;
      return `${base}package.json`;
    },

    async loadPackageJson(packageJsonUrl: string): Promise<Record<string, unknown>> {
      const res = await fetch(packageJsonUrl);
      if (!res.ok) {
        throw new Error(`Failed to fetch ${packageJsonUrl}: ${res.status} ${res.statusText}`);
      }
      return (await res.json()) as Record<string, unknown>;
    },
  });
}
