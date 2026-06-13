export interface ResolvedModule {
  name: string;
  url: string;
  version: string;
  packageJsonUrl: string;
}

interface ModuleNode {
  name: string;
  deps: string[];
  url: string;
  version: string;
  packageJsonUrl: string;
}

export interface ModuleResolverOptions {
  /** Resolve a dependency name relative to a base URL. */
  resolve: (baseUrl: string, moduleId: string) => Promise<string>;
  /** Find the nearest package.json URL for a given module URL. */
  findPackageJson: (moduleUrl: string) => Promise<string>;
  /** Load and parse a package.json from its URL. */
  loadPackageJson: (packageJsonUrl: string) => Promise<Record<string, unknown>>;
}

export class ModuleResolver {
  private readonly _resolve: ModuleResolverOptions["resolve"];
  private readonly _findPackageJson: ModuleResolverOptions["findPackageJson"];
  private readonly _loadPackageJson: ModuleResolverOptions["loadPackageJson"];

  constructor(options: ModuleResolverOptions) {
    this._resolve = options.resolve;
    this._findPackageJson = options.findPackageJson;
    this._loadPackageJson = options.loadPackageJson;
  }

  async resolveModules(baseUrl: string, moduleIds: string[]): Promise<ResolvedModule[]> {
    if (moduleIds.length === 0) return [];

    const graph = await this._buildGraph(baseUrl, moduleIds);

    // DFS from each root in input order: dependencies are placed
    // just before the module that needs them, preserving the
    // caller-specified order for independent modules.
    const UNVISITED = 0;
    const IN_PROGRESS = 1;
    const DONE = 2;
    const state = new Map<string, number>();
    const sorted: ModuleNode[] = [];

    const visit = (name: string): void => {
      const s = state.get(name) ?? UNVISITED;
      if (s === DONE) return;
      if (s === IN_PROGRESS) {
        throw new Error(`Circular dependency detected: ${name}`);
      }
      state.set(name, IN_PROGRESS);
      const node = graph.get(name);
      if (!node) return;
      for (const dep of node.deps) {
        if (graph.has(dep)) visit(dep);
      }
      state.set(name, DONE);
      sorted.push(node);
    };

    for (const id of moduleIds) visit(id);
    // Include any transitive deps not reachable via roots
    for (const name of graph.keys()) visit(name);

    return sorted.map(({ name, url, version, packageJsonUrl }) => ({
      name,
      url,
      version,
      packageJsonUrl,
    }));
  }

  private async _buildGraph(baseUrl: string, roots: string[]): Promise<Map<string, ModuleNode>> {
    const visited = new Map<string, ModuleNode>();
    // Queue entries: [moduleId, baseUrlToResolveFrom]
    const pending: Array<[string, string]> = roots.map((r) => [r, baseUrl]);
    const seen = new Set(roots);

    for (let i = 0; i < pending.length; i++) {
      const [id, fromUrl] = pending[i]!;
      if (visited.has(id)) continue;

      const moduleUrl = await this._resolve(fromUrl, id);
      const packageJsonUrl = await this._findPackageJson(moduleUrl);

      let pkg: Record<string, unknown>;
      try {
        pkg = await this._loadPackageJson(packageJsonUrl);
      } catch {
        // Unreadable package.json — treat as leaf node
        visited.set(id, {
          name: id,
          url: moduleUrl,
          version: "",
          packageJsonUrl,
          deps: [],
        });
        continue;
      }

      const deps: string[] = [];
      const dependencies = pkg.dependencies as Record<string, string> | undefined;
      if (dependencies) {
        for (const [depName, version] of Object.entries(dependencies)) {
          if (version.startsWith("workspace:")) {
            deps.push(depName);
          }
        }
      }

      const version = typeof pkg.version === "string" ? pkg.version : "";

      visited.set(id, {
        name: id,
        url: moduleUrl,
        version,
        packageJsonUrl,
        deps,
      });

      // Resolve transitive deps from the parent package's base URL
      for (const dep of deps) {
        if (!seen.has(dep)) {
          seen.add(dep);
          pending.push([dep, packageJsonUrl]);
        }
      }
    }

    return visited;
  }
}
