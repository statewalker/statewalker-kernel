import { readText } from "@statewalker/webrun-files";
import { describe, expect, it } from "vitest";
import { appFilesOf, cacheFilesOf } from "../src/prefix-files-api.js";
import { newWebAppModuleServer } from "../src/web-app-module-server.js";
import { WebAppNature } from "../src/web-app-nature.js";
import { HELLO_WORLD_FILES, setupProject, snapshot, touch } from "./util/web-app-fixture.js";

// Hermetic: local-relative-import fixture only (no npm dep imported), so prime needs
// no network. The declared `react` range is pinned in the lock but never fetched.

describe("transpileBuilder (via WebAppNature.scan)", () => {
  it("cold build transforms the reachable client+server graph with same-origin imports", async () => {
    const { project } = await setupProject();
    await new WebAppNature(project).scan();

    const cache = cacheFilesOf(project);
    expect(await cache.exists("/t/browser/~/client/main.ts")).toBe(true);
    expect(await cache.exists("/t/browser/~/client/greeting.ts")).toBe(true);
    expect(await cache.exists("/t/browser/~/server/index.ts")).toBe(true);
    expect(JSON.parse(await readText(cache, "/lock.json"))).toEqual({ react: "18.3.1" });

    // `main.ts`'s import of `./greeting.ts` is rewritten to a same-origin relative
    // URL — no CDN, no bare specifier, no import map.
    const main = await readText(cache, "/t/browser/~/client/main.ts");
    expect(main).toContain("./greeting.ts");
    expect(main).not.toContain("http");
  });

  it("an incremental edit re-transforms only the changed module; all others byte-identical", async () => {
    const { project, fs } = await setupProject();
    const nature = new WebAppNature(project);
    await nature.scan();

    const cache = cacheFilesOf(project);
    const before = await snapshot(cache);

    // Edit exactly one client module.
    await touch(
      fs,
      "/proj/client/greeting.ts",
      "export function greet(name: string): string {\n  return `HI ${name}`;\n}\n",
    );
    await nature.scan();

    // Incremental invalidation deletes the changed module's cache entry; a lazy fetch
    // re-transforms it (this is what a client reload does).
    const server = newWebAppModuleServer({ project: appFilesOf(project), cache });
    const resp = await server.fetch(new Request("http://x/~/client/greeting.ts"));
    expect(resp.status).toBe(200);

    const after = await snapshot(cache);

    // Only the edited module's entry changed content; every other entry (including
    // the sibling that imports it, and the lockfile) is byte-identical.
    const changed = [...after.keys()].filter((k) => before.get(k) !== after.get(k));
    expect(changed).toEqual(["/t/browser/~/client/greeting.ts"]);
    expect(after.get("/t/browser/~/client/greeting.ts")).toContain("HI");
    expect(after.get("/t/browser/~/client/main.ts")).toBe(
      before.get("/t/browser/~/client/main.ts"),
    );
  });

  it("invalidates a deleted module's transform so a warm server stops serving its stale body", async () => {
    const { project, fs } = await setupProject();
    const nature = new WebAppNature(project);
    await nature.scan();

    const cache = cacheFilesOf(project);
    expect(await readText(cache, "/t/browser/~/client/greeting.ts")).toContain("greet");

    // Delete a client module; the scanner reports it on `sources-removed`.
    await fs.remove("/proj/client/greeting.ts");
    await nature.scan();

    // The stale transform is dropped from the cache (not left to serve the deleted body).
    expect(await cache.exists("/t/browser/~/client/greeting.ts")).toBe(false);
    // A warm server no longer serves the deleted module's original content.
    const server = newWebAppModuleServer({ project: appFilesOf(project), cache });
    const resp = await server.fetch(new Request("http://x/~/client/greeting.ts"));
    expect(await resp.text()).not.toContain("greet");
  });

  it("surfaces a cold-prime failure instead of reporting a false success", async () => {
    // `main.ts` has a syntax error → the cold prime throws. The build must reject, not
    // converge silently (which would report success while the module went unbuilt).
    const { project } = await setupProject({
      ...HELLO_WORLD_FILES,
      "client/main.ts": "export const x: = ;\nthis is @@@ not valid\n",
    });

    await expect(new WebAppNature(project).scan()).rejects.toThrow();
  });
});
