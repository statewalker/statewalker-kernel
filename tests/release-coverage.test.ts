// Every public package must reach npm: it has to be a workspace package (pnpm-workspace.yaml's
// `packages` globs) and be packed by the `pack` job of .github/workflows/ci.yml, whose loop walks
// directory globs (`for dir in packages/*/ ...`). A package in a directory neither names is built
// and tested but never released. These tests read both files and check every package directory.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

/** Directory globs of the form `<dir>/*` (the only form this repository uses), as `<dir>`. */
function parents(globs: string[]): string[] {
  return globs.map((glob) => {
    const match = /^([\w.-]+)\/\*\/?$/.exec(glob);
    if (!match?.[1]) throw new Error(`unexpected glob ${glob}`);
    return match[1];
  });
}

function workspaceGlobs(): string[] {
  const yaml = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");
  const block = /^packages:\n((?:\s+-.*\n)+)/m.exec(yaml)?.[1] ?? "";
  return [...block.matchAll(/-\s*"?([^"\n]+)"?/g)].map((m) => (m[1] ?? "").trim());
}

function packGlobs(): string[] {
  const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  const loop = /for dir in ([^;]+); do/.exec(ci)?.[1];
  if (!loop) throw new Error("no `for dir in ...; do` loop in ci.yml");
  return loop.trim().split(/\s+/);
}

/** Public packages under the directories that may hold publishable packages. */
function publicPackageDirs(): string[] {
  const dirs: string[] = [];
  for (const parent of ["packages", "packages-react", "fragments"]) {
    const full = join(ROOT, parent);
    if (!existsSync(full)) continue;
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      const manifest = join(full, entry.name, "package.json");
      if (!entry.isDirectory() || !existsSync(manifest)) continue;
      if (JSON.parse(readFileSync(manifest, "utf8")).private === true) continue;
      dirs.push(`${parent}/${entry.name}`);
    }
  }
  return dirs;
}

describe("release coverage", () => {
  it("finds public packages in packages/ and packages-react/", () => {
    const dirs = publicPackageDirs();
    expect(dirs.some((d) => d.startsWith("packages/"))).toBe(true);
    expect(dirs.some((d) => d.startsWith("packages-react/"))).toBe(true);
  });

  it("every public package is a workspace package", () => {
    const covered = parents(workspaceGlobs());
    const missing = publicPackageDirs().filter((d) => !covered.includes(d.split("/")[0] ?? ""));
    expect(missing).toEqual([]);
  });

  it("every public package is packed by ci.yml's pack job", () => {
    const covered = parents(packGlobs());
    const missing = publicPackageDirs().filter((d) => !covered.includes(d.split("/")[0] ?? ""));
    expect(missing).toEqual([]);
  });
});
