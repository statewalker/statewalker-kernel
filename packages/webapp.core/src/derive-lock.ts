import type { FilesApi } from "@statewalker/webrun-files";
import { readText } from "@statewalker/webrun-files";
import type { Lockfile } from "@statewalker/webrun-modules";

/**
 * Derive a module-server lockfile from the app `package.json` (reimplemented here —
 * the notes-demo `deriveLock` lives only in that archived app and is not importable).
 * The lock MUST be **exact**: the module server's cache key is the pinned version, so
 * a range (`^18.3.1`, `~4.2`, `18`, `latest`, `workspace:*`, `file:…`) would resolve to
 * a different id than requested and 404. This is the chosen contract — dependencies
 * MUST be declared as exact `x.y.z` versions; anything else is rejected up front with a
 * clear error rather than silently mis-keyed (no registry resolution is attempted).
 */

/** Exact `x.y.z` with optional semver prerelease / build metadata — nothing else. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

/** Thrown when a `package.json` dependency is not pinned to an exact version. */
export class NonExactVersionError extends Error {
  constructor(
    readonly dependency: string,
    readonly range: string,
  ) {
    super(
      `Dependency "${dependency}" has non-exact version "${range}". webapp.core requires ` +
        "exact x.y.z versions in package.json (no ranges, ^, ~, dist-tags, or protocols).",
    );
    this.name = "NonExactVersionError";
  }
}

/**
 * Validate that `range` is an exact `x.y.z` version and return it unchanged; throw
 * `NonExactVersionError` otherwise. `dependency` names the offending entry in the error.
 */
export function toExactVersion(range: string, dependency = "dependency"): string {
  const version = range.trim();
  if (!EXACT_VERSION.test(version)) throw new NonExactVersionError(dependency, range);
  return version;
}

/** Read `<app>/package.json` `dependencies` and pin each to its exact version. */
export async function deriveLock(appFiles: FilesApi): Promise<Lockfile> {
  const manifest = JSON.parse(await readText(appFiles, "/package.json")) as {
    dependencies?: Record<string, string>;
  };
  const lock: Lockfile = {};
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    lock[name] = toExactVersion(range, name);
  }
  return lock;
}
