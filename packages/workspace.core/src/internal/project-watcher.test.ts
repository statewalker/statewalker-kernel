import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WATCH_INTERVAL_MS,
  type PollScheduler,
  ProjectWatcher,
  type WatchEvent,
} from "../public/builders/index.js";
import type { Project } from "../public/types/project.js";
import { Workspace } from "../public/types/workspace.js";

const enc = new TextEncoder();

async function project(files: Record<string, string>): Promise<{ p: Project; fs: MemFilesApi }> {
  const fs = new MemFilesApi();
  for (const [path, body] of Object.entries(files)) await fs.write(path, [enc.encode(body)]);
  const ws = new Workspace();
  ws.setFileSystem(fs, "A");
  await ws.open();
  const p = await ws.getProject("proj");
  if (!p) throw new Error("project not resolved");
  return { p, fs };
}

/** A manual clock: captures the scheduled tick so a test drives a single poll. */
function fakeClock() {
  let current: { intervalMs: number; tick: () => void | Promise<void> } | undefined;
  const scheduler: PollScheduler = (intervalMs, tick) => {
    current = { intervalMs, tick };
    return () => {
      current = undefined;
    };
  };
  return {
    scheduler,
    get intervalMs() {
      return current?.intervalMs;
    },
    get running() {
      return current !== undefined;
    },
    /** Fire exactly one poll (as if the interval elapsed once) and await it. */
    async advance() {
      if (!current) throw new Error("no poll scheduled");
      await current.tick();
    },
  };
}

/** Rewrite `path` guaranteeing a strictly greater mtime than any prior write. */
async function touch(fs: MemFilesApi, path: string, body: string): Promise<void> {
  const before = Date.now();
  while (Date.now() === before) {
    /* spin until the wall clock advances so MemFilesApi stamps a new mtime */
  }
  await fs.write(path, [enc.encode(body)]);
}

describe("ProjectWatcher — configurable-interval polling", () => {
  it("interval is configurable, re-configurable, and subscriptions survive a restart", async () => {
    const { p, fs } = await project({ "/proj/a.txt": "a" });
    const clock = fakeClock();
    const watcher = p.requireAdapter(ProjectWatcher).configure({ scheduler: clock.scheduler });

    watcher.start(100);
    expect(clock.intervalMs).toBe(100);

    const events: WatchEvent[] = [];
    watcher.watch("**", (e) => events.push(e));

    await clock.advance(); // first poll seeds the baseline silently (no startup flood)
    expect(events).toHaveLength(0);

    watcher.start(50); // re-configure spacing; subscription + baseline must persist
    expect(clock.intervalMs).toBe(50);

    await fs.write("/proj/b.txt", [enc.encode("b")]);
    await clock.advance();
    expect(events).toHaveLength(1);
    expect(events.at(0)?.changed).toEqual(["b.txt"]);
  });

  it("stop halts polling until start is called again", async () => {
    const { p, fs } = await project({ "/proj/a.txt": "a" });
    const clock = fakeClock();
    const watcher = p.requireAdapter(ProjectWatcher).configure({ scheduler: clock.scheduler });

    const events: WatchEvent[] = [];
    watcher.start(100);
    watcher.watch("**", (e) => events.push(e));
    await clock.advance(); // baseline

    watcher.stop();
    expect(clock.running).toBe(false);

    await fs.write("/proj/b.txt", [enc.encode("b")]);
    // No scheduled poll while stopped.
    expect(clock.running).toBe(false);

    watcher.start(100); // restart resumes delivery
    expect(clock.running).toBe(true);
    await clock.advance();
    expect(events.at(-1)?.changed).toEqual(["b.txt"]);
  });

  it("bare start() falls back to the configured default interval", async () => {
    const { p } = await project({ "/proj/a.txt": "a" });
    const clock = fakeClock();
    p.requireAdapter(ProjectWatcher)
      .configure({ scheduler: clock.scheduler, defaultIntervalMs: 777 })
      .start();
    expect(clock.intervalMs).toBe(777);
  });

  it("bare start() with no configured default uses the built-in default", async () => {
    const { p } = await project({ "/proj/a.txt": "a" });
    const clock = fakeClock();
    p.requireAdapter(ProjectWatcher).configure({ scheduler: clock.scheduler }).start();
    expect(clock.intervalMs).toBe(DEFAULT_WATCH_INTERVAL_MS);
  });
});

describe("ProjectWatcher — glob-scoped subscriptions", () => {
  it("delivers only to the subscriber whose glob matches the changed URI", async () => {
    const { p, fs } = await project({
      "/proj/package.json": "{}",
      "/proj/client/main.tsx": "x",
    });
    const clock = fakeClock();
    const watcher = p.requireAdapter(ProjectWatcher).configure({ scheduler: clock.scheduler });
    watcher.start(100);
    await clock.advance(); // baseline (no subscribers yet)

    const clientEvents: WatchEvent[] = [];
    const pkgEvents: WatchEvent[] = [];
    watcher.watch("client/**", (e) => clientEvents.push(e));
    watcher.watch("package.json", (e) => pkgEvents.push(e));

    await fs.write("/proj/client/extra.tsx", [enc.encode("y")]);
    await clock.advance();

    expect(clientEvents).toHaveLength(1);
    expect(clientEvents.at(0)?.changed).toEqual(["client/extra.tsx"]);
    expect(pkgEvents).toHaveLength(0);
  });

  it("stops delivering after unsubscribe", async () => {
    const { p, fs } = await project({ "/proj/a.txt": "a" });
    const clock = fakeClock();
    const watcher = p.requireAdapter(ProjectWatcher).configure({ scheduler: clock.scheduler });
    watcher.start(100);
    await clock.advance(); // baseline

    const events: WatchEvent[] = [];
    const off = watcher.watch("**", (e) => events.push(e));

    await fs.write("/proj/b.txt", [enc.encode("b")]);
    await clock.advance();
    expect(events).toHaveLength(1);

    off();
    await fs.write("/proj/c.txt", [enc.encode("c")]);
    await clock.advance();
    expect(events).toHaveLength(1); // no further delivery
  });
});

describe("ProjectWatcher — mtime diff", () => {
  it("reports new and mtime-advanced files as changed", async () => {
    const { p, fs } = await project({ "/proj/a.txt": "a" });
    const clock = fakeClock();
    const watcher = p.requireAdapter(ProjectWatcher).configure({ scheduler: clock.scheduler });
    watcher.start(100);
    await clock.advance(); // baseline seeds a.txt

    const events: WatchEvent[] = [];
    watcher.watch("**", (e) => events.push(e));

    // A brand-new file.
    await fs.write("/proj/b.txt", [enc.encode("b")]);
    await clock.advance();
    expect(events.at(-1)?.changed).toEqual(["b.txt"]);
    expect(events.at(-1)?.removed).toEqual([]);

    // An mtime advance on an existing file.
    await touch(fs, "/proj/a.txt", "a2");
    await clock.advance();
    expect(events.at(-1)?.changed).toEqual(["a.txt"]);
  });

  it("reports deleted files as removed", async () => {
    const { p, fs } = await project({ "/proj/a.txt": "a" });
    const clock = fakeClock();
    const watcher = p.requireAdapter(ProjectWatcher).configure({ scheduler: clock.scheduler });
    watcher.start(100);
    await clock.advance(); // baseline seeds a.txt

    const events: WatchEvent[] = [];
    watcher.watch("**", (e) => events.push(e));

    await fs.remove("/proj/a.txt");
    await clock.advance();
    expect(events).toHaveLength(1);
    expect(events.at(0)?.removed).toEqual(["a.txt"]);
    expect(events.at(0)?.changed).toEqual([]);
  });

  it("a no-op poll delivers nothing", async () => {
    const { p } = await project({ "/proj/a.txt": "a" });
    const clock = fakeClock();
    const watcher = p.requireAdapter(ProjectWatcher).configure({ scheduler: clock.scheduler });
    watcher.start(100);
    await clock.advance(); // baseline

    const events: WatchEvent[] = [];
    watcher.watch("**", (e) => events.push(e));

    await clock.advance(); // nothing changed
    expect(events).toHaveLength(0);
  });
});

describe("ProjectWatcher — seed on start", () => {
  it("a subscriber present before start gets no first-poll flood, only later changes", async () => {
    const { p, fs } = await project({ "/proj/a.txt": "a", "/proj/b.txt": "b" });
    const clock = fakeClock();
    const watcher = p.requireAdapter(ProjectWatcher).configure({ scheduler: clock.scheduler });

    const events: WatchEvent[] = [];
    watcher.watch("**", (e) => events.push(e)); // subscribe BEFORE start
    watcher.start(100);

    await clock.advance(); // first poll seeds the existing files silently
    expect(events).toHaveLength(0);

    await fs.write("/proj/c.txt", [enc.encode("c")]);
    await clock.advance();
    expect(events).toHaveLength(1);
    expect(events.at(0)?.changed).toEqual(["c.txt"]);
  });
});

describe("ProjectWatcher — matcher normalisation", () => {
  it("a leading-slash scope and a bare directory both match project-relative URIs", async () => {
    const { p, fs } = await project({ "/proj/client/main.tsx": "x" });
    const clock = fakeClock();
    const watcher = p.requireAdapter(ProjectWatcher).configure({ scheduler: clock.scheduler });
    watcher.start(100);
    await clock.advance(); // seed baseline

    const slashEvents: WatchEvent[] = [];
    const bareEvents: WatchEvent[] = [];
    watcher.watch("/client/**", (e) => slashEvents.push(e)); // leading slash
    watcher.watch("client", (e) => bareEvents.push(e)); // bare directory → subtree

    await fs.write("/proj/client/deep/nested.tsx", [enc.encode("y")]);
    await clock.advance();

    expect(slashEvents.at(0)?.changed).toEqual(["client/deep/nested.tsx"]);
    expect(bareEvents.at(0)?.changed).toEqual(["client/deep/nested.tsx"]);
  });
});

describe("ProjectWatcher — delivery robustness", () => {
  it("isolates a throwing handler: siblings still receive and the batch is not dropped", async () => {
    const { p, fs } = await project({ "/proj/a.txt": "a" });
    const clock = fakeClock();
    const watcher = p.requireAdapter(ProjectWatcher).configure({ scheduler: clock.scheduler });
    watcher.start(100);
    await clock.advance(); // seed baseline

    const seen: WatchEvent[] = [];
    watcher.watch("**", () => {
      throw new Error("boom");
    });
    watcher.watch("**", (e) => seen.push(e));

    await fs.write("/proj/b.txt", [enc.encode("b")]);
    await clock.advance();

    expect(seen).toHaveLength(1);
    expect(seen.at(0)?.changed).toEqual(["b.txt"]);
  });

  it("delivers one change to every subscriber on the same scope", async () => {
    const { p, fs } = await project({ "/proj/a.txt": "a" });
    const clock = fakeClock();
    const watcher = p.requireAdapter(ProjectWatcher).configure({ scheduler: clock.scheduler });
    watcher.start(100);
    await clock.advance(); // seed baseline

    const first: WatchEvent[] = [];
    const second: WatchEvent[] = [];
    watcher.watch("**", (e) => first.push(e));
    watcher.watch("**", (e) => second.push(e));

    await fs.write("/proj/c.txt", [enc.encode("c")]);
    await clock.advance();

    expect(first.at(0)?.changed).toEqual(["c.txt"]);
    expect(second.at(0)?.changed).toEqual(["c.txt"]);
  });

  it("reports a re-added file as changed after it was removed", async () => {
    const { p, fs } = await project({ "/proj/a.txt": "a" });
    const clock = fakeClock();
    const watcher = p.requireAdapter(ProjectWatcher).configure({ scheduler: clock.scheduler });
    watcher.start(100);
    await clock.advance(); // seed baseline {a.txt}

    const events: WatchEvent[] = [];
    watcher.watch("**", (e) => events.push(e));

    await fs.remove("/proj/a.txt");
    await clock.advance();
    expect(events.at(-1)?.removed).toEqual(["a.txt"]);

    await fs.write("/proj/a.txt", [enc.encode("a-again")]);
    await clock.advance();
    expect(events.at(-1)?.changed).toEqual(["a.txt"]);
  });
});

describe("ProjectWatcher — default scheduler", () => {
  it("the built-in setInterval scheduler drives polls and stops cleanly", async () => {
    vi.useFakeTimers();
    try {
      const { p } = await project({ "/proj/a.txt": "a" });
      const watcher = p.requireAdapter(ProjectWatcher); // no injected scheduler
      const pollSpy = vi.spyOn(watcher, "poll").mockResolvedValue();

      watcher.start(10);
      await vi.advanceTimersByTimeAsync(35);
      const polled = pollSpy.mock.calls.length;
      expect(polled).toBeGreaterThanOrEqual(1);

      watcher.stop();
      await vi.advanceTimersByTimeAsync(35);
      expect(pollSpy.mock.calls.length).toBe(polled); // no further ticks after stop
    } finally {
      vi.useRealTimers();
    }
  });
});
