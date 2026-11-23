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

// React can also enter without an import: JSX in a .tsx file under the automatic runtime, a
// tsconfig `jsx` option, or a React dependency in a package.json. `scripts/check-no-react.mjs`
// (run by `lint:check`) refuses those under packages/.
function checkNoReact() {
  const run = spawnSync(process.execPath, [join(ROOT, "scripts", "check-no-react.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

function probe(relativePath: string, source: string) {
  probes.push(join(ROOT, relativePath.split("/").slice(0, 2).join("/")));
  mkdirSync(join(ROOT, dirname(relativePath)), { recursive: true });
  writeFileSync(join(ROOT, relativePath), source);
}

describe("check-no-react on packages/", () => {
  it("passes on the repository as it is", () => {
    expect(checkNoReact()).toMatchObject({ status: 0 });
  });

  const cases: [string, string, string][] = [
    [
      "a .tsx file",
      "packages/__no-react-probe__/src/view.tsx",
      "export const C = () => <div />;\n",
    ],
    [
      "a .jsx file",
      "packages/__no-react-probe__/src/view.jsx",
      "export const C = () => <div />;\n",
    ],
    [
      "a tsconfig jsx option",
      "packages/__no-react-probe__/tsconfig.json",
      '{ "compilerOptions": { "jsx": "react-jsx" } }\n',
    ],
    [
      "a react dependency",
      "packages/__no-react-probe__/package.json",
      '{ "name": "probe", "dependencies": { "react": "^19.0.0" } }\n',
    ],
    [
      "a react-dom peer dependency",
      "packages/__no-react-probe__/package.json",
      '{ "name": "probe", "peerDependencies": { "react-dom": "^19.0.0" } }\n',
    ],
    [
      "an @types/react dev dependency",
      "packages/__no-react-probe__/package.json",
      '{ "name": "probe", "devDependencies": { "@types/react": "^19.0.0" } }\n',
    ],
  ];

  for (const [what, path, source] of cases) {
    it(`fails for ${what}`, () => {
      probe(path, source);
      const result = checkNoReact();
      expect(result.status).toBe(1);
      expect(result.output).toContain("packages/__no-react-probe__");
    });
  }

  it("lets packages-react/ hold .tsx files and React dependencies", () => {
    probe("packages-react/__no-react-probe__/src/view.tsx", "export const C = () => <div />;\n");
    probe(
      "packages-react/__no-react-probe__/package.json",
      '{ "name": "probe", "dependencies": { "react": "^19.0.0" } }\n',
    );
    expect(checkNoReact()).toMatchObject({ status: 0 });
  });
});
