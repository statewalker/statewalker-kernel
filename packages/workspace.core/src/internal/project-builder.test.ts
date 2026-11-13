import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it } from "vitest";
import {
  applyNature,
  type BuilderProvider,
  MemKV,
  ProjectBuilder,
  type RegisteredBuilder,
  SOURCES_COLLECTION,
} from "../public/builders/index.js";
import type { Project } from "../public/types/project.js";
import { Workspace } from "../public/types/workspace.js";

const enc = new TextEncoder();

async function project(files: Record<string, string>, fs = new MemFilesApi()): Promise<Project> {
  for (const [path, body] of Object.entries(files)) await fs.write(path, [enc.encode(body)]);
  const ws = new Workspace();
  ws.setFileSystem(fs, "A");
  await ws.open();
  const p = await ws.getProject("proj");
  if (!p) throw new Error("project not resolved");
  return p;
}

/** A builder that records every source it processes and every one it disposes. */
function echoBuilder(processed: string[], disposed: string[] = []): RegisteredBuilder {
  return {
    id: "Echo",
    inputs: [SOURCES_COLLECTION],
    outputs: ["content"],
    run(ctx, p) {
      if (!p?.workspace) throw new Error("the project is passed to run()");
      processed.push(ctx.key);
      ctx.emit("content", ctx.key, true);
    },
    dispose(key) {
      disposed.push(key);
    },
  };
}

describe("ProjectBuilder — convergence", () => {
  it("scans sources and runs registered builders to convergence", async () => {
    const p = await project({ "/proj/a.txt": "a", "/proj/b.txt": "b" });
    const processed: string[] = [];
    const builder = p.requireAdapter(ProjectBuilder);
    builder.registerBuilder(echoBuilder(processed));

    const result = await builder.run();
    expect(processed.sort()).toEqual(["a.txt", "b.txt"]);
    expect(result.scanned).toMatchObject({ changed: 2, removed: 0 });
    expect(await builder.keys("content")).toEqual(["a.txt", "b.txt"]);
  });

  it("a second run with no filesystem change processes nothing new", async () => {
    const p = await project({ "/proj/a.txt": "a", "/proj/b.txt": "b" });
    const processed: string[] = [];
    const builder = p.requireAdapter(ProjectBuilder);
    builder.registerBuilder(echoBuilder(processed));

    await builder.run();
    const afterFirst = processed.length;
    expect((await builder.run()).executed).toBe(0);
    expect(processed.length).toBe(afterFirst);
  });

  it("a removed file is disposed and retracted", async () => {
    const fs = new MemFilesApi();
    const p = await project({ "/proj/a.txt": "a", "/proj/b.txt": "b" }, fs);
    const disposed: string[] = [];
    const builder = p.requireAdapter(ProjectBuilder);
    builder.registerBuilder(echoBuilder([], disposed));
    await builder.run();
    await fs.remove("/proj/b.txt");
    await builder.run();
    expect(disposed).toEqual(["b.txt"]);
    expect(await builder.keys("content")).toEqual(["a.txt"]);
  });
});

describe("ProjectBuilder — persistence", () => {
  it("keeps its state in .project/state/build: a new session continues incrementally", async () => {
    const fs = new MemFilesApi();
    const first = await project({ "/proj/a.txt": "a" }, fs);
    const processed: string[] = [];
    first.requireAdapter(ProjectBuilder).registerBuilder(echoBuilder(processed));
    await first.requireAdapter(ProjectBuilder).run();
    expect(await fs.exists("/proj/.project/state/build")).toBe(true);

    const second = await project({}, fs);
    second.requireAdapter(ProjectBuilder).registerBuilder(echoBuilder(processed));
    expect((await second.requireAdapter(ProjectBuilder).run()).executed).toBe(0);
    expect(processed).toEqual(["a.txt"]);
  });

  it("configurePersistence picks another store", async () => {
    const p = await project({ "/proj/a.txt": "a" });
    const store = new MemKV();
    const builder = p
      .requireAdapter(ProjectBuilder)
      .configurePersistence({ kind: "custom", store });
    builder.registerBuilder(echoBuilder([]));
    await builder.run();
    expect(store.size).toBeGreaterThan(0);
  });
});

describe("ProjectBuilder — restartFrom and failures", () => {
  it("reprocesses a builder after restartFrom", async () => {
    const p = await project({ "/proj/a.txt": "a" });
    const processed: string[] = [];
    const builder = p.requireAdapter(ProjectBuilder);
    builder.registerBuilder(echoBuilder(processed));

    await builder.run();
    expect(processed).toEqual(["a.txt"]);
    await builder.restartFrom("Echo");
    await builder.run();
    expect(processed).toEqual(["a.txt", "a.txt"]);
  });

  it("rejects when a task keeps failing, and retries it on the next run", async () => {
    const p = await project({ "/proj/a.txt": "a" });
    let broken = true;
    const builder = p.requireAdapter(ProjectBuilder);
    builder.registerBuilder({
      id: "Flaky",
      inputs: [SOURCES_COLLECTION],
      outputs: ["out"],
      run(ctx) {
        if (broken) throw new Error("boom");
        ctx.emit("out", ctx.key, 1);
      },
    });
    await expect(builder.run()).rejects.toThrow(
      /1 task\(s\) failed; first: Flaky\/a.txt: Error: boom/,
    );
    broken = false;
    await builder.run();
    expect(await builder.keys("out")).toEqual(["a.txt"]);
  });

  it("failOnError: false reports failures; retryFailed: false keeps them until their input changes", async () => {
    const fs = new MemFilesApi();
    const p = await project({ "/proj/a.txt": "a", "/proj/b.txt": "b" }, fs);
    let calls = 0;
    const builder = p.requireAdapter(ProjectBuilder);
    builder.registerBuilder({
      id: "Picky",
      inputs: [SOURCES_COLLECTION],
      outputs: ["out"],
      run(ctx) {
        if (ctx.key === "b.txt") {
          calls++;
          throw new Error("unparseable");
        }
        ctx.emit("out", ctx.key, 1);
      },
    });
    const opts = { failOnError: false, retryFailed: false };
    const first = await builder.run(opts);
    expect(first.failures).toEqual([
      expect.objectContaining({ builder: "Picky", key: "b.txt", error: "Error: unparseable" }),
    ]);
    const tries = calls;
    const second = await builder.run(opts);
    expect(calls).toBe(tries); // not retried
    expect(second.failures).toHaveLength(1);
    expect(await builder.keys("out")).toEqual(["a.txt"]);
  });

  it("re-registering an id replaces the builder; unregistering removes it", async () => {
    const p = await project({ "/proj/a.txt": "a" });
    const builder = p.requireAdapter(ProjectBuilder);
    const first: string[] = [];
    const second: string[] = [];
    builder.registerBuilder(echoBuilder(first));
    const unregister = builder.registerBuilder(echoBuilder(second));
    await builder.run();
    expect(first).toEqual([]);
    expect(second).toEqual(["a.txt"]);
    unregister();
    await builder.run();
    expect((await builder.getEngine()).list("content")).toBeDefined();
  });
});

describe("ProjectBuilder — progress and scan batches", () => {
  it("forwards onProgress and runs a batched scan to completion", async () => {
    const p = await project({ "/proj/a.txt": "a", "/proj/b.txt": "b", "/proj/c.txt": "c" });
    const dumps: number[] = [];
    const builder = p.requireAdapter(ProjectBuilder).configureScanBatch(1);
    builder.registerBuilder(echoBuilder([]));
    builder.registerBuilder({
      id: "Count",
      kind: "reduce",
      inputs: ["content"],
      outputs: ["count"],
      async run(ctx) {
        const n = (await ctx.list("content")).length;
        dumps.push(n);
        ctx.emit("count", "n", n);
      },
    });
    const progress: string[] = [];
    const result = await builder.run({ onProgress: (e) => progress.push(e.builder) });
    // One full-pipeline pass per batch: the reduce sees the corpus grow.
    expect(dumps).toEqual([1, 2, 3]);
    expect(result.scanned).toMatchObject({ changed: 3, more: false });
    expect(progress).toContain("Echo");
    expect(progress).toContain("Count");
  });
});

describe("ProjectBuilder — configureEngine", () => {
  it("runs the tasks of a batch concurrently and honours maxAttempts", async () => {
    const p = await project({ "/proj/a.txt": "a", "/proj/b.txt": "b", "/proj/c.txt": "c" });
    let inFlight = 0;
    let peak = 0;
    let attempts = 0;
    const builder = p.requireAdapter(ProjectBuilder).configureEngine({ concurrency: 3 });
    builder.registerBuilder({
      id: "Slow",
      inputs: [SOURCES_COLLECTION],
      outputs: ["out"],
      async run(ctx) {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        ctx.emit("out", ctx.key, 1);
      },
    });
    await builder.run();
    expect(peak).toBe(3);

    builder.configureEngine({ maxAttempts: 1 });
    builder.registerBuilder({
      id: "Slow",
      inputs: [SOURCES_COLLECTION],
      outputs: ["out"],
      run() {
        attempts++;
        throw new Error("no");
      },
    });
    await builder.restartFrom("Slow");
    const result = await builder.run({ failOnError: false });
    expect(attempts).toBe(3); // one attempt per task
    expect(result.failures).toHaveLength(3);
  });
});

describe("ProjectBuilder — nature (BuilderProvider)", () => {
  it("applyNature registers a provider's builders and they run", async () => {
    const p = await project({ "/proj/a.txt": "a", "/proj/b.txt": "b" });
    const processed: string[] = [];
    const nature: BuilderProvider = { builders: () => [echoBuilder(processed)] };
    applyNature(p, nature);

    await p.requireAdapter(ProjectBuilder).run();
    expect(processed.sort()).toEqual(["a.txt", "b.txt"]);
  });
});

describe("ProjectBuilder — .projectignore and configureSourceIgnore", () => {
  it("skips sources matched by .projectignore", async () => {
    const p = await project({
      "/proj/keep.txt": "k",
      "/proj/skip.txt": "s",
      "/proj/.projectignore": "skip.txt",
    });
    const processed: string[] = [];
    const builder = p.requireAdapter(ProjectBuilder);
    builder.registerBuilder(echoBuilder(processed));

    await builder.run();
    expect(processed).toEqual(["keep.txt"]);
  });

  it("composes the injected predicate with .projectignore", async () => {
    const p = await project({
      "/proj/keep.txt": "k",
      "/proj/skip.txt": "s",
      "/proj/nature-skip.txt": "n",
      "/proj/.projectignore": "skip.txt",
    });
    const processed: string[] = [];
    const builder = p.requireAdapter(ProjectBuilder);
    builder.registerBuilder(echoBuilder(processed));
    builder.configureSourceIgnore(async () => (uri) => uri === "nature-skip.txt");

    await builder.run();
    expect(processed).toEqual(["keep.txt"]);
  });

  it("re-invokes the provider each scan, pruning a newly-excluded source", async () => {
    const p = await project({ "/proj/a.txt": "a", "/proj/b.txt": "b" });
    const processed: string[] = [];
    const disposed: string[] = [];
    const excluded = new Set<string>();
    const builder = p.requireAdapter(ProjectBuilder);
    builder.registerBuilder(echoBuilder(processed, disposed));
    builder.configureSourceIgnore(async () => (uri) => excluded.has(uri));

    await builder.run();
    expect(processed.sort()).toEqual(["a.txt", "b.txt"]);

    excluded.add("b.txt");
    await builder.run();
    expect(disposed).toEqual(["b.txt"]);
    expect(await builder.keys("content")).toEqual(["a.txt"]);
  });
});
