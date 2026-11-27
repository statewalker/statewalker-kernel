#!/usr/bin/env node
// Builds apps/notes into dist/:
//
//   dist/index.html                    the page, with the import map
//   dist/shared/<module>.js            the shared modules (React, react-dom, dockview, shadcn, the
//                                      client API), one ES module each, importing one another by
//                                      bare specifier
//   dist/main.js, dist/main.css        the shell: the kernel, the core fragments, the workbench
//   dist/archives/<id>/                each app fragment: its root files, its client half
//                                      (client/index.js, client/index.css) and its server half
//                                      bundled for CellB in a browser (server/bundle.js)
//   dist/fragments-sw.js,              the launch configuration `browser`: CellB's router (a
//   dist/fragment-shard.js             ServiceWorker) and the shard worker running the server
//                                      halves (statewalker/statewalker-root#259)
//   dist/launch.json                   who serves `/fragments/{id}/…`: `none` here; the launch
//                                      scripts serve their own (scripts/launch.mjs)
//
// The shell and every fragment bundle leave the shared modules external, as bare specifiers the
// import map resolves, so each one loads once. Fragment CSS is prebuilt with Tailwind per fragment,
// against the shared shadcn tokens and without preflight.
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { bundleWorkerForBrowser } from "@statewalker/cellb/node";
import { parseJsonc } from "@statewalker/kernel.core";
import semver from "semver";
import { build } from "vite";
import { coreServerFragments } from "./core-fragments.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const SHIMS = join(ROOT, "node_modules", ".shared-modules");
const require = createRequire(join(ROOT, "package.json"));
const platform = JSON.parse(readFileSync(join(ROOT, "platform.json"), "utf8"));
const application = JSON.parse(readFileSync(join(ROOT, "application.json"), "utf8"));
const SHARED = Object.keys(platform.shared);

/** The file a shared module is served from, under dist/shared/. */
const fileOf = (specifier) => `${specifier.replace(/^@/, "").replaceAll("/", "-")}.js`;

/** The package a specifier belongs to (`react/jsx-runtime` → `react`). */
const packageOf = (specifier) =>
  specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];

function checkSharedVersions() {
  const problems = [];
  for (const [specifier, range] of Object.entries(platform.shared)) {
    const name = packageOf(specifier);
    const manifest = JSON.parse(
      readFileSync(join(ROOT, "node_modules", name, "package.json"), "utf8"),
    );
    if (!semver.satisfies(manifest.version, range)) {
      problems.push(`${specifier}: ${manifest.version} is outside ${range}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `shared modules outside platform.json's ranges (a platform version change):\n  ${problems.join("\n  ")}`,
    );
  }
}

/** Whether a package is CommonJS (React): its entry has no `import` condition and no `type`. */
function isCommonJs(specifier) {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, "node_modules", packageOf(specifier), "package.json"), "utf8"),
  );
  return manifest.type !== "module" && !JSON.stringify(manifest.exports ?? {}).includes('"import"');
}

/** The id a shim imports a shared module's own code by, resolved by the bundler, not external. */
const SOURCE = "shared-source:";

/**
 * The entry of each shared module: a CommonJS package (React) gets an ES module re-exporting its
 * exports by name (read from the package itself), an ES package is re-exported as is. A shim
 * imports the package's code through `shared-source:`, since its bare specifier stays external
 * for everyone else.
 */
function writeShims() {
  rmSync(SHIMS, { recursive: true, force: true });
  mkdirSync(SHIMS, { recursive: true });
  const entries = {};
  for (const specifier of SHARED) {
    const source = JSON.stringify(SOURCE + specifier);
    let code;
    if (isCommonJs(specifier)) {
      const names = Object.keys(require(specifier)).filter((n) => n !== "default");
      code = `import m from ${source};\nexport default m;\nexport const { ${names.join(", ")} } = m;\n`;
    } else {
      code = `export * from ${source};\n`;
    }
    const shim = join(SHIMS, fileOf(specifier));
    writeFileSync(shim, code);
    entries[fileOf(specifier).replace(/\.js$/, "")] = shim;
  }
  return entries;
}

/**
 * Leaves the shared modules to the import map. A CommonJS `require()` of one (react-dom requiring
 * react) becomes a module importing it, since an ES module cannot `require` in a browser.
 */
function sharedExternals() {
  const PREFIX = "\0shared-require:";
  return {
    name: "shared-externals",
    enforce: "pre",
    async resolveId(id, importer, options) {
      if (id.startsWith(SOURCE)) {
        return this.resolve(id.slice(SOURCE.length), importer, { ...options, skipSelf: true });
      }
      if (!SHARED.includes(id)) return undefined;
      return options?.kind === "require-call" ? { id: PREFIX + id } : { id, external: true };
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return undefined;
      return `import * as m from ${JSON.stringify(id.slice(PREFIX.length))};\nmodule.exports = m;\n`;
    },
  };
}

/** One Vite library build: ES modules, the shared modules external, production React. */
async function bundle({ entry, outDir, cssFileName, chunks = "chunks/[name]-[hash].js" }) {
  await build({
    root: ROOT,
    configFile: false,
    logLevel: "warn",
    publicDir: false,
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    plugins: [sharedExternals()],
    build: {
      outDir,
      emptyOutDir: true,
      minify: true,
      sourcemap: true,
      lib: { entry, formats: ["es"], ...(cssFileName ? { cssFileName } : {}) },
      rolldownOptions: {
        output: { entryFileNames: "[name].js", chunkFileNames: chunks },
        // Radix and lucide mark their modules "use client", which means nothing in a browser bundle.
        onwarn(warning, warn) {
          if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
        },
      },
    },
  });
}

/** Prebuilt Tailwind CSS: `input` compiled to `output`, minified. */
function tailwind(input, output) {
  const cli = join(dirname(require.resolve("@tailwindcss/cli/package.json")), "dist", "index.mjs");
  execFileSync(process.execPath, [cli, "-i", input, "-o", output, "--minify"], {
    cwd: ROOT,
    stdio: ["ignore", "ignore", "inherit"],
  });
}

async function buildFragments() {
  const ids = [];
  const fragments = join(ROOT, "fragments");
  for (const folder of readdirSync(fragments, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    const source = join(fragments, folder.name);
    const manifest = parseJsonc(readFileSync(join(source, "fragment.jsonc"), "utf8")).value;
    const out = join(DIST, "archives", manifest.id);
    for (const file of readdirSync(source)) {
      if (/^(fragment(\.[a-z]+)?|wrangler)\.jsonc$/.test(file)) {
        mkdirSync(out, { recursive: true });
        copyFileSync(join(source, file), join(out, file));
      }
    }
    if (manifest.aspects?.server) {
      // The server half for CellB in a browser: its wrangler.jsonc's main, bundled with the
      // Workers globals and nodejs_compat as a shard worker loads it.
      const dir = manifest.aspects.server.dir ?? "server";
      const wrangler = parseJsonc(readFileSync(join(source, "wrangler.jsonc"), "utf8")).value;
      mkdirSync(join(out, dir), { recursive: true });
      writeFileSync(
        join(out, dir, "bundle.js"),
        await bundleWorkerForBrowser(join(source, wrangler.main)),
      );
    }
    // Scripts a Node host runs as jobs (the `host-jobs` binding, statewalker-root#411): shipped in
    // the archive, the only place host-jobs takes a script from.
    if (manifest.bindings?.includes("host-jobs") && existsSync(join(source, "scripts")))
      cpSync(join(source, "scripts"), join(out, "scripts"), { recursive: true });
    // A client aspect with no code of its own (only extensions, as commands a host serves).
    const clientDir = manifest.aspects?.client?.dir ?? "client";
    if (manifest.aspects?.client && existsSync(join(source, clientDir, "index.tsx"))) {
      const dir = clientDir;
      await bundle({
        entry: { index: join(source, dir, "index.tsx") },
        outDir: join(out, dir),
      });
      tailwind(join(source, dir, "index.css"), join(out, dir, "index.css"));
    }
    ids.push(manifest.id);
  }
  return ids;
}

/** The core fragments' server halves, for the browser's shard pool (not in the catalog). */
async function buildCoreServerHalves() {
  for (const { id, dir, serverDir, wrangler } of coreServerFragments()) {
    const out = join(DIST, "archives", id, serverDir);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "bundle.js"), await bundleWorkerForBrowser(join(dir, wrangler.main)));
  }
}

function writeIndex(fragments) {
  const imports = Object.fromEntries(SHARED.map((s) => [s, `./shared/${fileOf(s)}`]));
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${application.brand.name}</title>
    <meta name="platform-version" content="${platform.version}" />
    <script type="importmap">
${JSON.stringify({ imports }, null, 2)}
    </script>
    <link rel="stylesheet" href="./main.css" />
    <script type="module" src="./main.js"></script>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
`;
  writeFileSync(join(DIST, "index.html"), html);
  writeFileSync(
    join(DIST, "archives", "index.json"),
    `${JSON.stringify({ fragments }, null, 2)}\n`,
  );
}

/**
 * The launch configuration `browser`: CellB's router as the app's ServiceWorker and its shard
 * worker, each one ES module with everything it uses (SQLite WASM's file beside it, in assets/).
 */
async function buildFragmentHost() {
  await build({
    root: ROOT,
    configFile: false,
    logLevel: "warn",
    publicDir: false,
    worker: { format: "es" },
    build: {
      outDir: DIST,
      emptyOutDir: false,
      minify: true,
      sourcemap: true,
      target: "es2022",
      rolldownOptions: {
        input: {
          "fragments-sw": join(ROOT, "src", "fragments-sw.ts"),
          "fragment-shard": join(ROOT, "src", "fragment-shard.ts"),
        },
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "assets/[name]-[hash].js",
          assetFileNames: "assets/[name]-[hash][extname]",
        },
      },
    },
  });
}

checkSharedVersions();
rmSync(DIST, { recursive: true, force: true });
// The shell's build empties dist/: it goes first, the shared modules and the fragments beside it.
await bundle({ entry: { main: join(ROOT, "src", "main.tsx") }, outDir: DIST, cssFileName: "main" });
await bundle({ entry: writeShims(), outDir: join(DIST, "shared") });
const fragments = await buildFragments();
await buildCoreServerHalves();
writeIndex(fragments);
await buildFragmentHost();
writeFileSync(join(DIST, "launch.json"), `${JSON.stringify({ fragments: "none" }, null, 2)}\n`);
console.log(`apps/notes built in ${DIST} (fragments: ${fragments.join(", ")})`);
