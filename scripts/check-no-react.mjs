#!/usr/bin/env node
// packages/ holds UI-free, isomorphic packages; React belongs in packages-react/ (statewalker-root
// ADR 2026-11-19-platform-project-and-fragment-repositories). Biome's noRestrictedImports refuses
// React imports there; this script refuses the ways React enters without an import: .tsx/.jsx
// files (JSX under the automatic runtime), a tsconfig `jsx` option, and React in a package.json.
// A core fragment's src/ is React-free too (its client half is in client/, which may use React,
// so its package.json and tsconfig may name React): there, only .tsx/.jsx files are refused.
//
// Usage: `node scripts/check-no-react.mjs` (part of `lint:check`). Exit 0 when clean, 1 otherwise.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const PACKAGES = join(ROOT, "packages");
const FRAGMENTS = join(ROOT, "fragments");
const REACT_PACKAGES = new Set(["react", "react-dom", "@types/react", "@types/react-dom"]);
const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
const SKIP = new Set(["node_modules", "dist", "dist-browser", ".turbo"]);

const problems = [];
const where = (file) => relative(ROOT, file);

function readJson(file) {
  try {
    // tsconfig files may carry comments and trailing commas.
    const text = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\/|(^|[^:"])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(text);
  } catch (error) {
    problems.push(`${where(file)}: cannot be read as JSON (${error.message})`);
    return undefined;
  }
}

/** JSX files under `dir`, recursively. */
function walkJsx(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkJsx(full);
    else if (/\.(tsx|jsx)$/.test(entry.name))
      problems.push(`${where(full)}: JSX file in a fragment's src/`);
  }
}

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (/\.(tsx|jsx)$/.test(entry.name)) {
      problems.push(`${where(full)}: JSX file in packages/`);
    } else if (/^tsconfig.*\.json$/.test(entry.name)) {
      const jsx = readJson(full)?.compilerOptions?.jsx;
      if (jsx !== undefined) problems.push(`${where(full)}: sets compilerOptions.jsx ("${jsx}")`);
    } else if (entry.name === "package.json") {
      const manifest = readJson(full) ?? {};
      for (const field of DEPENDENCY_FIELDS) {
        for (const name of Object.keys(manifest[field] ?? {})) {
          if (REACT_PACKAGES.has(name)) problems.push(`${where(full)}: ${field} lists ${name}`);
        }
      }
    }
  }
}

if (existsSync(PACKAGES)) walk(PACKAGES);
if (existsSync(FRAGMENTS)) {
  for (const entry of readdirSync(FRAGMENTS, { withFileTypes: true })) {
    const src = join(FRAGMENTS, entry.name, "src");
    if (entry.isDirectory() && existsSync(src)) walkJsx(src);
  }
}

if (problems.length > 0) {
  console.error(
    "React is not allowed in packages/ or a fragment's src/ (it belongs in packages-react/ or a fragment's client/):",
  );
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
