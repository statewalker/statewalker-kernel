// The platform's core fragments that have a server half (statewalker/statewalker-root#409): built
// into `dist/archives/<id>/server/bundle.js` for the browser's shard pool (scripts/build.mjs), and
// run by the Node and wrangler launch configurations beside the app's own (scripts/launch.mjs).
// They are not in the app's catalog: the shell installs them as core fragments.
import { readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseJsonc } from "@statewalker/kernel.core";

const ROOT = resolve(import.meta.dirname, "..");

/** The core fragment packages with a server half, as apps/notes depends on them. */
const PACKAGES = ["@statewalker/system.tasks"];

/** Each one's id, its package folder (the fragment) and its server project (wrangler.jsonc). */
export function coreServerFragments() {
  return PACKAGES.map((name) => {
    const dir = realpathSync(join(ROOT, "node_modules", name));
    const manifest = parseJsonc(readFileSync(join(dir, "fragment.jsonc"), "utf8")).value;
    const wrangler = parseJsonc(readFileSync(join(dir, "wrangler.jsonc"), "utf8")).value;
    return { id: manifest.id, dir, serverDir: manifest.aspects?.server?.dir ?? "server", wrangler };
  });
}
