import { readText, writeText } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it, vi } from "vitest";
import { newWebAppModuleServer } from "../src/web-app-module-server.js";

// Hermetic: a trivial local TS module and NO npm deps, so prime/transform needs
// no network. The transformed entry lands under the cache's `t/<target>/` layout.
const ENTRY = { url: "/client/main.ts" } as const;
const CACHE_ENTRY = "/t/browser/~/client/main.ts";

async function seedProject(): Promise<MemFilesApi> {
  const project = new MemFilesApi();
  await writeText(project, "/client/main.ts", "export const answer: number = 42;\n");
  return project;
}

describe("newWebAppModuleServer", () => {
  it("a second server over a warm cache serves the module with no re-transform", async () => {
    const project = await seedProject();
    const cache = new MemFilesApi();

    // Cold: first server primes the entry into the persistent cache.
    const first = newWebAppModuleServer({ project, cache });
    await first.prime(ENTRY);

    expect(await cache.exists(CACHE_ENTRY)).toBe(true);
    expect(await cache.exists("/lock.json")).toBe(true);
    const warmBody = await readText(cache, CACHE_ENTRY);

    // Warm: a fresh server over the SAME cache must read, never write.
    const second = newWebAppModuleServer({ project, cache });
    const writeSpy = vi.spyOn(cache, "write");

    const response = await second.fetch(new Request("http://localhost/~/client/main.ts"));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(warmBody);
    // No transform (or any other write) happened on the warm serve.
    expect(writeSpy).not.toHaveBeenCalled();
    // The cached entry is byte-identical to the cold build.
    expect(await readText(cache, CACHE_ENTRY)).toBe(warmBody);
  });

  it("resolves a bare specifier same-origin under /deps/ from a locked, pre-seeded cache (no network)", async () => {
    // A project module importing a bare specifier, plus a pre-resolved cache for one
    // tiny package: `raw/` + `lock.json` pinning it. The locked-resolution branch reads
    // these off disk — no source `load`, no network — so the test is hermetic yet
    // genuinely exercises dep resolution (drop the lock → the else branch would try the
    // network and this fetch would 404).
    const project = new MemFilesApi();
    await writeText(project, "/client/main.ts", 'import { v } from "tiny";\nexport const x = v;\n');

    const cache = new MemFilesApi();
    await writeText(cache, "/lock.json", JSON.stringify({ tiny: "1.0.0" }));
    await writeText(
      cache,
      "/raw/tiny@1.0.0/package.json",
      JSON.stringify({ name: "tiny", version: "1.0.0", main: "index.js" }),
    );
    await writeText(cache, "/raw/tiny@1.0.0/index.js", "export const v = 42;\n");

    const server = newWebAppModuleServer({ project, cache });
    const response = await server.fetch(new Request("http://x/~/client/main.ts"));

    expect(response.status).toBe(200);
    const body = await response.text();
    // The bare `tiny` import was rewritten to a same-origin `~deps` proxy module (the ~deps
    // proxy layer) — no CDN, no bare specifier. The proxy pins the locked `deps/tiny@1.0.0`
    // version (verified directly in @statewalker/webrun-modules' own suite).
    expect(body).toContain("~deps/main.ts/deps.tiny.js");
    expect(body).not.toContain("http");
    expect(body).not.toContain('from "tiny"');
  });
});
