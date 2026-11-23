// `packages/` holds the UI-free, isomorphic packages of the platform; React lives in
// `packages-react/` (ADR 2026-11-19-platform-project-and-fragment-repositories in
// statewalker-root). The rule is a Biome lint, so `lint:check` fails any React import there.
// These tests write a probe file, run Biome on it, and remove it.

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");
const probes: string[] = [];

function lint(relativePath: string, source: string) {
  const dir = join(ROOT, dirname(relativePath));
  probes.push(join(ROOT, relativePath.split("/").slice(0, 2).join("/")));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(ROOT, relativePath), source);
  const biome = join(ROOT, "node_modules", ".bin", "biome");
  const run = spawnSync(biome, ["lint", "--max-diagnostics=50", relativePath], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

afterEach(() => {
  for (const probe of probes.splice(0)) rmSync(probe, { recursive: true, force: true });
});

describe("the no-React rule on packages/", () => {
  const imports = [
    'import { useState } from "react";\nexport const s = useState;\n',
    'import { createRoot } from "react-dom/client";\nexport const r = createRoot;\n',
    'import { jsx } from "react/jsx-runtime";\nexport const j = jsx;\n',
    'export { useEffect } from "react";\n',
    'export const lazy = () => import("react");\n',
  ];

  for (const source of imports) {
    it(`fails lint for ${JSON.stringify(source.split("\n")[0])}`, () => {
      const result = lint("packages/__no-react-probe__/src/probe.ts", source);
      expect(result.status).not.toBe(0);
      expect(result.output).toContain("noRestrictedImports");
    });
  }

  it("lets packages-react/ import React", () => {
    const result = lint(
      "packages-react/__no-react-probe__/src/probe.ts",
      'import { useState } from "react";\nexport const s = useState;\n',
    );
    expect(result.output).not.toContain("noRestrictedImports");
    expect(result.status).toBe(0);
  });

  it("lets packages/ import other modules", () => {
    const result = lint(
      "packages/__no-react-probe__/src/probe.ts",
      'import { join } from "node:path";\nexport const j = join;\n',
    );
    expect(result.status).toBe(0);
  });
});
