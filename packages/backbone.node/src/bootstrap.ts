import { accessSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type AppManifest,
  activateModules,
  formatModulesMap,
  getLogger,
  ModuleResolver,
} from "@statewalker/backbone.core";
import { resolve as resolveImport } from "import-meta-resolve";

function toFilePath(url: string): string {
  return url.startsWith("file://") ? fileURLToPath(url) : url;
}

function findPackageJsonUp(dir: string): string {
  let current = resolve(dir);
  for (;;) {
    const candidate = join(current, "package.json");
    try {
      accessSync(candidate);
      return candidate;
    } catch {
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  throw new Error(`No package.json found above ${dir}`);
}

/**
 * Fallback for packages whose root export is not defined (ERR_PACKAGE_PATH_NOT_EXPORTED).
 * Walks node_modules to locate the package directory and returns its package.json path.
 */
function resolvePackageJsonFallback(packageName: string, fromDir: string): string {
  let dir = resolve(fromDir);
  const root = resolve("/");
  while (dir !== root) {
    const candidate = join(dir, "node_modules", packageName, "package.json");
    try {
      accessSync(candidate);
      return realpathSync(candidate);
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error(`Cannot find package '${packageName}' from ${fromDir}`);
}

function createNodeResolver(): ModuleResolver {
  return new ModuleResolver({
    async resolve(baseUrl: string, moduleId: string): Promise<string> {
      try {
        return resolveImport(moduleId, baseUrl);
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          (error as NodeJS.ErrnoException).code === "ERR_PACKAGE_PATH_NOT_EXPORTED"
        ) {
          const baseDir = dirname(toFilePath(baseUrl));
          const pkgJsonPath = resolvePackageJsonFallback(moduleId, baseDir);
          return pathToFileURL(dirname(pkgJsonPath)).href;
        }
        throw error;
      }
    },

    async findPackageJson(moduleUrl: string): Promise<string> {
      const filePath = toFilePath(moduleUrl);
      const packageJsonPath = findPackageJsonUp(dirname(filePath));
      return pathToFileURL(packageJsonPath).href;
    },

    async loadPackageJson(packageJsonUrl: string): Promise<Record<string, unknown>> {
      const raw = readFileSync(toFilePath(packageJsonUrl), "utf-8");
      return JSON.parse(raw) as Record<string, unknown>;
    },
  });
}

/**
 * Node-side bootstrap. Accepts an `AppManifest`, resolves each root through
 * the filesystem resolver, topo-sorts the dependency graph, and activates
 * each module via the shared `activateModules` loop.
 */
export async function bootstrap(
  manifest: AppManifest,
  ctx: Record<string, unknown> = {},
): Promise<() => Promise<void>> {
  const logger = getLogger(ctx);
  logger.info("[backbone] Starting...");

  const resolver = createNodeResolver();
  const baseUrl = pathToFileURL(join(process.cwd(), "package.json")).href;
  const ordered = await resolver.resolveModules(baseUrl, manifest.roots);

  const modulesMap: Record<string, string> = {};
  for (const mod of ordered) modulesMap[mod.name] = mod.url;

  const loggerCleanup = () => logger.info("[backbone] Shutting down...");

  const moduleCleanup = await activateModules(
    ordered,
    async (mod) => {
      try {
        return (await import(mod.url)) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    },
    ctx,
  );

  logger.info(`[backbone] Started with ${ordered.length} module(s)`, formatModulesMap(modulesMap));

  return async () => {
    await moduleCleanup();
    loggerCleanup();
  };
}
