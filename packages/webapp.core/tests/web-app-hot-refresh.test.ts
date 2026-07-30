import { readText } from "@statewalker/webrun-files";
import type { WatchEvent } from "@statewalker/workspace.core";
import { describe, expect, it } from "vitest";
import { appFilesOf, cacheFilesOf } from "../src/prefix-files-api.js";
import { newWebAppModuleServer } from "../src/web-app-module-server.js";
import { WebAppNature } from "../src/web-app-nature.js";
import { fakeClock, setupProject, touch } from "./util/web-app-fixture.js";

describe("WebAppNature hot refresh", () => {
  it("an edit triggers a rebuild without a manual scan, and a subscriber observes it", async () => {
    const { project, fs } = await setupProject();
    const nature = new WebAppNature(project);
    await nature.scan(); // cold build

    const cache = cacheFilesOf(project);
    const coldMain = await readText(cache, "/t/browser/~/client/main.ts");

    const clock = fakeClock();
    const handle = await nature.startHotRefresh({ scheduler: clock.scheduler });
    if (!handle) throw new Error("no hot-refresh handle");
    expect(clock.running).toBe(true);

    await clock.advance(); // baseline poll seeds the watcher snapshot
    await handle.whenIdle();

    // Observe only edits from here on.
    const observed: WatchEvent[] = [];
    handle.watcher.watch("client/**", (e) => observed.push(e));

    await touch(
      fs,
      "/proj/client/main.ts",
      'import { greet } from "./greeting.ts";\nexport const msg = greet("edited");\n',
    );
    await clock.advance();
    await handle.whenIdle();

    // A subscriber saw the edit event…
    expect(observed.flatMap((e) => e.changed)).toContain("client/main.ts");

    // …and the rebuild invalidated the edited module's cache entry, so a lazy fetch
    // yields new content (its content-hash changed) without any manual scan() call.
    const server = newWebAppModuleServer({ project: appFilesOf(project), cache });
    const newMain = await (await server.fetch(new Request("http://x/~/client/main.ts"))).text();
    expect(newMain).not.toBe(coldMain);
    expect(newMain).toContain("edited");
  });

  it("stopping hot refresh halts further rebuilds", async () => {
    const { project } = await setupProject();
    const nature = new WebAppNature(project);
    await nature.scan();

    const clock = fakeClock();
    const handle = await nature.startHotRefresh({ scheduler: clock.scheduler });
    if (!handle) throw new Error("no hot-refresh handle");
    expect(clock.running).toBe(true);

    handle.stop();
    expect(clock.running).toBe(false); // no scheduled poll → no further rebuilds
  });
});
