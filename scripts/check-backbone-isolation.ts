#!/usr/bin/env tsx
// Enforces the backbone-independence rule (design §D4 of repo-split-foundation):
// no backbone-*/package.json may declare a runtime dependency on any
// @statewalker/* package OTHER than a sibling @statewalker/backbone-*.
// devDependencies are allowed.
//
// Non-backbone siblings (shared-*, app-shell-core) are forbidden: vendor the
// narrow slice you need into backbone-common/src/_vendor/ and rewire.
//
// Usage: `tsx scripts/check-backbone-isolation.ts`
// Exit 0 on clean; exit 1 on any violation (with a human-readable report).

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PACKAGES = resolve(ROOT, "packages");

interface Violation {
  pkg: string;
  dep: string;
  version: string;
  scope: "dependencies" | "peerDependencies";
}

async function checkPackage(pkgDir: string): Promise<Violation[]> {
  const pjPath = join(pkgDir, "package.json");
  const raw = await readFile(pjPath, "utf8");
  const pj = JSON.parse(raw) as {
    name?: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const violations: Violation[] = [];
  for (const scope of ["dependencies", "peerDependencies"] as const) {
    const deps = pj[scope] ?? {};
    for (const [dep, version] of Object.entries(deps)) {
      if (
        dep.startsWith("@statewalker/") &&
        !dep.startsWith("@statewalker/backbone-")
      ) {
        violations.push({ pkg: pj.name ?? pkgDir, dep, version, scope });
      }
    }
  }
  return violations;
}

async function main() {
  const entries = await readdir(PACKAGES, { withFileTypes: true });
  const backboneDirs = entries
    .filter((e) => e.isDirectory() && e.name.startsWith("backbone-"))
    .map((e) => join(PACKAGES, e.name));

  if (backboneDirs.length === 0) {
    console.error("check-backbone-isolation: no backbone-* packages found");
    process.exit(1);
  }

  const violations: Violation[] = [];
  for (const dir of backboneDirs) {
    violations.push(...(await checkPackage(dir)));
  }

  if (violations.length === 0) {
    console.log(
      `check-backbone-isolation: OK (${backboneDirs.length} backbone-* packages clean)`,
    );
    process.exit(0);
  }

  console.error("check-backbone-isolation: VIOLATIONS");
  for (const v of violations) {
    console.error(
      `  ${v.pkg} [${v.scope}]: depends on ${v.dep}@${v.version}`,
    );
  }
  console.error(
    "\nBackbone packages MUST NOT depend on @statewalker/* at runtime.",
  );
  console.error(
    "Vendor the narrow slice into backbone-common/src/_vendor/ and rewire.",
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
