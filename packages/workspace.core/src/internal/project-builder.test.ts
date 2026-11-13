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
function echoBuilder(
  processed: string[],
  disposed: string[] = [],
  id = "Echo",
  output = "content",
): RegisteredBuilder {
  return {
    id,
    inputs: [SOURCES_COLLECTION],
    outputs: [output],
    run(ctx, p) {
      if (!p?.workspace) throw new Error("the project is passed to run()");
      processed.push(ctx.key);
      ctx.emit(output, ctx.key, true);
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
    expect(builder.registeredBuilders()).toEqual([]);
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

describe("ProjectBuilder — builders registered late, changes during a run", () => {
  it("a builder registered after a run covers the files scanned before", async () => {
    const p = await project({ "/proj/a.txt": "a", "/proj/b.txt": "b" });
    const builder = p.requireAdapter(ProjectBuilder);
    builder.registerBuilder(echoBuilder([]));
    await builder.run();
    const late: string[] = [];
    builder.registerBuilder(echoBuilder(late, [], "Late", "late"));
    await builder.run();
    expect(late.sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("a run with no builders, then a registered one, processes every file", async () => {
    const p = await project({ "/proj/a.txt": "a" });
    const builder = p.requireAdapter(ProjectBuilder);
    await builder.run();
    const processed: string[] = [];
    builder.registerBuilder(echoBuilder(processed));
    await builder.run();
    expect(processed).toEqual(["a.txt"]);
  });

  it("a new session with an extra builder runs it over the persisted sources", async () => {
    const fs = new MemFilesApi();
    const first = await project({ "/proj/a.txt": "a" }, fs);
    first.requireAdapter(ProjectBuilder).registerBuilder(echoBuilder([]));
    await first.requireAdapter(ProjectBuilder).run();

    const second = await project({}, fs);
    const echo: string[] = [];
    const late: string[] = [];
    const b2 = second.requireAdapter(ProjectBuilder);
    b2.registerBuilder(echoBuilder(echo));
    b2.registerBuilder(echoBuilder(late, [], "Late", "late"));
    await b2.run();
    expect(echo).toEqual([]); // unchanged builder: nothing to do
    expect(late).toEqual(["a.txt"]);
  });

  it("a changed builder version re-runs its tasks", async () => {
    const fs = new MemFilesApi();
    const first = await project({ "/proj/a.txt": "a" }, fs);
    const processed: string[] = [];
    first.requireAdapter(ProjectBuilder).registerBuilder({ ...echoBuilder(processed), version: 1 });
    await first.requireAdapter(ProjectBuilder).run();
    const second = await project({}, fs);
    second
      .requireAdapter(ProjectBuilder)
      .registerBuilder({ ...echoBuilder(processed), version: 1 });
    await second.requireAdapter(ProjectBuilder).run();
    expect(processed).toEqual(["a.txt"]);
    const third = await project({}, fs);
    third.requireAdapter(ProjectBuilder).registerBuilder({ ...echoBuilder(processed), version: 2 });
    await third.requireAdapter(ProjectBuilder).run();
    expect(processed).toEqual(["a.txt", "a.txt"]);
  });

  it("reads before a known builder is registered do not make it re-run", async () => {
    const fs = new MemFilesApi();
    const files = { "/proj/a.txt": "a", "/proj/b.txt": "b" };
    const first = await project(files, fs);
    first.requireAdapter(ProjectBuilder).registerBuilder(echoBuilder([]));
    first.requireAdapter(ProjectBuilder).registerBuilder(echoBuilder([], [], "Late", "late"));
    await first.requireAdapter(ProjectBuilder).run();

    const second = await project({}, fs);
    const b2 = second.requireAdapter(ProjectBuilder);
    const late: string[] = [];
    b2.registerBuilder(echoBuilder([]));
    await b2.status();
    await b2.keys("content");
    b2.registerBuilder(echoBuilder(late, [], "Late", "late"));
    expect((await b2.run()).executed).toBe(0);
    expect(late).toEqual([]);
  });

  it("a builder absent from runs that changed something catches up when registered again", async () => {
    const fs = new MemFilesApi();
    const p = await project({ "/proj/a.txt": "a" }, fs);
    const builder = p.requireAdapter(ProjectBuilder);
    const late: string[] = [];
    builder.registerBuilder(echoBuilder([]));
    const unregister = builder.registerBuilder(echoBuilder(late, [], "Late", "late"));
    await builder.run();
    unregister();
    await builder.run(); // nothing changed: Late stays current
    builder.registerBuilder(echoBuilder(late, [], "Late", "late"));
    await builder.run();
    expect(late).toEqual(["a.txt"]); // ran once: it was current when registered again

    const drop = builder.registerBuilder(echoBuilder(late, [], "Late", "late"));
    drop();
    await fs.write("/proj/b.txt", [enc.encode("b")]);
    await builder.run(); // b.txt arrives while Late is absent
    builder.registerBuilder(echoBuilder(late, [], "Late", "late"));
    await builder.run();
    expect(late.sort()).toEqual(["a.txt", "a.txt", "b.txt"]); // caught up: every task re-run
  });

  it("work left by an interrupted run is caught up after a session without the builder", async () => {
    const fs = new MemFilesApi();
    const files: Record<string, string> = {};
    for (let i = 0; i < 5; i++) files[`/proj/f${i}.txt`] = String(i);
    const s1 = await project(files, fs);
    const late: string[] = [];
    const b1 = s1.requireAdapter(ProjectBuilder);
    b1.registerBuilder(echoBuilder([]));
    b1.registerBuilder(echoBuilder(late, [], "Late", "late"));
    await b1.run({ maxTasks: 7 }); // Late is left with queued tasks

    const s2 = await project({}, fs);
    s2.requireAdapter(ProjectBuilder).registerBuilder(echoBuilder([]));
    await s2.requireAdapter(ProjectBuilder).run(); // Late absent: its queue is dropped

    const s3 = await project({}, fs);
    const b3 = s3.requireAdapter(ProjectBuilder);
    b3.registerBuilder(echoBuilder([]));
    b3.registerBuilder(echoBuilder(late, [], "Late", "late"));
    await b3.run();
    expect(await b3.keys("late")).toHaveLength(5);
  });

  it("a restart asked outside a run survives a run without the builder", async () => {
    const p = await project({ "/proj/a.txt": "a" });
    const builder = p.requireAdapter(ProjectBuilder);
    const late: string[] = [];
    builder.registerBuilder(echoBuilder([]));
    const drop = builder.registerBuilder(echoBuilder(late, [], "Late", "late"));
    await builder.run();
    await builder.restartFrom("Late");
    drop();
    await builder.run();
    builder.registerBuilder(echoBuilder(late, [], "Late", "late"));
    await builder.run();
    expect(late).toEqual(["a.txt", "a.txt"]);
  });

  it("a new version registered during a run re-runs the builder's tasks next run", async () => {
    const p = await project({ "/proj/a.txt": "a", "/proj/b.txt": "b" });
    const builder = p.requireAdapter(ProjectBuilder);
    const v2: string[] = [];
    let release!: () => void;
    const started = new Promise<void>((r) => {
      release = r;
    });
    builder.registerBuilder({
      ...echoBuilder([]),
      version: 1,
      async run(ctx) {
        release();
        await new Promise((r) => setTimeout(r, 5));
        ctx.emit("content", ctx.key, true);
      },
    });
    const running = builder.run();
    await started;
    builder.registerBuilder({ ...echoBuilder(v2), version: 2 });
    await running;
    await builder.run();
    expect(v2.sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("an interrupted run's leftover tasks resume without redoing the finished ones", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 10; i++) files[`/proj/f${i}.txt`] = String(i);
    const p = await project(files);
    const processed: string[] = [];
    const builder = p.requireAdapter(ProjectBuilder).configureEngine({ batchSize: 2 });
    builder.registerBuilder(echoBuilder(processed));
    await builder.run({ maxTasks: 4 });
    expect(processed).toHaveLength(4);
    await builder.run();
    expect(processed).toHaveLength(10); // the 6 left, not all 10 again
  });

  it("reopen() reads what another writer committed to the store meanwhile", async () => {
    const fs = new MemFilesApi();
    const p1 = await project({ "/proj/a.txt": "a" }, fs);
    const b1 = p1.requireAdapter(ProjectBuilder);
    b1.registerBuilder(echoBuilder([]));
    await b1.run();
    expect(await b1.keys("content")).toEqual(["a.txt"]);

    // Another writer (a second session) adds a file and builds.
    await fs.write("/proj/b.txt", [enc.encode("b")]);
    const p2 = await project({}, fs);
    const b2 = p2.requireAdapter(ProjectBuilder);
    b2.registerBuilder(echoBuilder([]));
    await b2.run();

    expect(await b1.keys("content")).toEqual(["a.txt"]); // stale in-memory copy
    await b1.reopen();
    expect(await b1.keys("content")).toEqual(["a.txt", "b.txt"]);
  });

  it("reopen() waits for accessor calls in flight; an engine kept from before refuses writes", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 50; i++) files[`/proj/f${i}.txt`] = String(i);
    const fs = new MemFilesApi();
    const p = await project(files, fs);
    const b = p.requireAdapter(ProjectBuilder);
    b.registerBuilder(echoBuilder([], [], "A", "a"));
    b.registerBuilder(echoBuilder([], [], "B", "b"));
    await b.run();

    const old = await b.getEngine();
    const restartA = b.restartFrom("A"); // in flight on the old store
    await b.reopen();
    await b.restartFrom("B"); // on the reopened store
    await restartA;
    await expect(old.invalidate("A")).rejects.toThrow(/reopened/);

    const again = await project({}, fs);
    const b2 = again.requireAdapter(ProjectBuilder);
    b2.registerBuilder(echoBuilder([], [], "A", "a"));
    b2.registerBuilder(echoBuilder([], [], "B", "b"));
    expect((await b2.status()).queued).toEqual({ A: 50, B: 50 });
  });

  it("a run or a read started while reopen() waits runs after it, on the reopened store", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 20; i++) files[`/proj/f${i}.txt`] = String(i);
    const fs = new MemFilesApi();
    const p = await project(files, fs);
    const b = p.requireAdapter(ProjectBuilder);
    b.registerBuilder({
      ...echoBuilder([]),
      async run(ctx) {
        await new Promise((r) => setTimeout(r, 1));
        ctx.emit("content", ctx.key, true);
      },
    });
    const status = b.status();
    const reopened = b.reopen();
    const run = b.run();
    const keys = b.keys("content");
    await Promise.all([status, reopened, run, keys]); // none fails on a closed store
    expect(await b.keys("content")).toHaveLength(20);

    const again = await project({}, fs);
    const b2 = again.requireAdapter(ProjectBuilder);
    b2.registerBuilder(echoBuilder([]));
    expect(await b2.keys("content")).toHaveLength(20);
  });

  it("status() counts only the dead letters of registered builders", async () => {
    const p = await project({ "/proj/a.txt": "a" });
    const builder = p.requireAdapter(ProjectBuilder);
    const unregister = builder.registerBuilder({
      id: "Bad",
      inputs: [SOURCES_COLLECTION],
      outputs: ["bad"],
      run() {
        throw new Error("boom");
      },
    });
    await builder.run({ failOnError: false });
    expect((await builder.status()).deadLetters).toBe(1);
    unregister();
    expect((await builder.status()).deadLetters).toBe(0);
  });

  it("re-registering keeps the state of a memory store", async () => {
    const p = await project({ "/proj/a.txt": "a" });
    const processed: string[] = [];
    const builder = p.requireAdapter(ProjectBuilder).configurePersistence({ kind: "memory" });
    builder.registerBuilder(echoBuilder(processed));
    await builder.run();
    builder.registerBuilder(echoBuilder(processed)); // same id, same version
    await builder.run();
    expect(processed).toEqual(["a.txt"]);
    expect(await builder.keys("content")).toEqual(["a.txt"]);
  });

  it("registering and reading during a run keeps one engine: no work is lost or repeated", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 20; i++) files[`/proj/f${i}.txt`] = String(i);
    const fs = new MemFilesApi();
    const p = await project(files, fs);
    const builder = p.requireAdapter(ProjectBuilder).configureEngine({ batchSize: 2 });
    const processed: string[] = [];
    let release!: () => void;
    const midway = new Promise<void>((r) => {
      release = r;
    });
    builder.registerBuilder({
      ...echoBuilder(processed),
      async run(ctx) {
        processed.push(ctx.key);
        if (processed.length === 6) release();
        await new Promise((r) => setTimeout(r, 1));
        ctx.emit("content", ctx.key, true);
      },
    });
    const running = builder.run();
    await midway;
    const other: string[] = [];
    builder.registerBuilder(echoBuilder(other, [], "Other", "other"));
    await builder.status();
    await builder.list("content");
    await builder.restartFrom("Other");
    await running;
    expect(processed).toHaveLength(20);
    await builder.run();
    expect(processed).toHaveLength(20); // nothing re-executed
    expect(other).toHaveLength(20);

    const reopened = await project({}, fs);
    const rb = reopened.requireAdapter(ProjectBuilder);
    rb.registerBuilder(echoBuilder(processed));
    rb.registerBuilder(echoBuilder(other, [], "Other", "other"));
    expect((await rb.run()).executed).toBe(0);
  });

  it("dead letters of a builder no longer registered do not fail runs", async () => {
    const p = await project({ "/proj/a.txt": "a" });
    const builder = p.requireAdapter(ProjectBuilder);
    const unregister = builder.registerBuilder({
      id: "Bad",
      inputs: [SOURCES_COLLECTION],
      outputs: ["bad"],
      run() {
        throw new Error("boom");
      },
    });
    await expect(builder.run()).rejects.toThrow(/Bad/);
    unregister();
    builder.registerBuilder(echoBuilder([]));
    const result = await builder.run();
    expect(result.failures).toEqual([]);
    expect(await builder.deadLetters()).toEqual([]);
  });

  it("a batched scan stops after one rotation when files keep changing", async () => {
    const fs = new MemFilesApi();
    const p = await project({ "/proj/a.txt": "a", "/proj/b.txt": "b", "/proj/log.txt": "" }, fs);
    let runs = 0;
    const builder = p.requireAdapter(ProjectBuilder).configureScanBatch(1);
    builder.registerBuilder({
      id: "Log",
      inputs: [SOURCES_COLLECTION],
      outputs: ["o"],
      async run(ctx) {
        runs++;
        await fs.write("/proj/log.txt", [enc.encode("x".repeat(runs))]);
        await fs.write("/proj/log2.txt", [enc.encode("x".repeat(runs))]);
        ctx.emit("o", ctx.key, 1);
      },
    });
    const result = await builder.run();
    expect(runs).toBeLessThan(10);
    expect(result.scanned.more).toBe(true);
  });

  it("maxTasks bounds the whole run across scan batches", async () => {
    const p = await project({ "/proj/a.txt": "a", "/proj/b.txt": "b", "/proj/c.txt": "c" });
    const processed: string[] = [];
    const builder = p.requireAdapter(ProjectBuilder).configureScanBatch(1);
    builder.registerBuilder(echoBuilder(processed));
    const result = await builder.run({ maxTasks: 2 });
    expect(processed).toHaveLength(2);
    expect(result.pending).toBe(true);
  });

  it("configureScanBatch rejects a non-positive or fractional size", () => {
    const builder = new ProjectBuilder({} as Project);
    expect(() => builder.configureScanBatch(0)).toThrow(RangeError);
    expect(() => builder.configureScanBatch(1.5)).toThrow(RangeError);
  });
});

describe("ProjectBuilder — steps()", () => {
  function files(n: number): Record<string, string> {
    const out: Record<string, string> = {};
    for (let i = 0; i < n; i++) out[`/proj/f${i}.txt`] = String(i);
    return out;
  }

  it("yields the scan, then each committed batch, and returns the result", async () => {
    const p = await project(files(5));
    const processed: string[] = [];
    const builder = p.requireAdapter(ProjectBuilder).configureEngine({ batchSize: 2 });
    builder.registerBuilder(echoBuilder(processed));
    const steps = builder.steps();
    const kinds: string[] = [];
    let next = await steps.next();
    while (!next.done) {
      kinds.push(
        next.value.kind === "scan" ? `scan:${next.value.changed}` : `batch:${next.value.tasks}`,
      );
      next = await steps.next();
    }
    expect(kinds).toEqual(["scan:5", "batch:2", "batch:2", "batch:1"]);
    expect(next.value).toMatchObject({ executed: 5, pending: false, scanned: { changed: 5 } });
  });

  it("waits at each yield, and break stops cleanly: the next run finishes the rest", async () => {
    const p = await project(files(6));
    const processed: string[] = [];
    const builder = p.requireAdapter(ProjectBuilder).configureEngine({ batchSize: 2 });
    builder.registerBuilder(echoBuilder(processed));
    let batches = 0;
    for await (const step of builder.steps()) {
      if (step.kind !== "batch") continue;
      const before = processed.length;
      await new Promise((r) => setTimeout(r, 5));
      expect(processed.length).toBe(before);
      if (++batches === 2) break;
    }
    expect(processed).toHaveLength(4);
    const rest = await builder.run(); // the engine was released by break
    expect(processed).toHaveLength(6);
    expect(rest.executed).toBe(2);
  });

  it("a suspended generator holds the turn: run() and reopen() wait for it", async () => {
    const p = await project(files(4));
    const builder = p.requireAdapter(ProjectBuilder).configureEngine({ batchSize: 2 });
    builder.registerBuilder(echoBuilder([]));
    const steps = builder.steps();
    await steps.next(); // the scan
    const order: string[] = [];
    const run = builder.run().then(() => order.push("run"));
    const reopen = builder.reopen().then(() => order.push("reopen"));
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([]);
    for (let n = await steps.next(); !n.done; n = await steps.next()) order.push("step");
    await Promise.all([run, reopen]);
    expect(order).toEqual(["step", "step", "run", "reopen"]);
  });

  it("reads between steps do not deadlock with a pending reopen()", async () => {
    const p = await project(files(4));
    const builder = p.requireAdapter(ProjectBuilder).configureEngine({ batchSize: 2 });
    builder.registerBuilder(echoBuilder([]));
    const steps = builder.steps();
    await steps.next(); // suspended after the scan
    const reopened = builder.reopen(); // queued behind the suspended run
    const status = await Promise.race([
      builder.status(),
      new Promise<"stuck">((r) => setTimeout(() => r("stuck"), 200)),
    ]);
    expect(status).not.toBe("stuck");
    expect(await builder.keys("content")).toEqual([]); // read from the run's engine
    for (let n = await steps.next(); !n.done; n = await steps.next());
    await reopened;
    expect(await builder.keys("content")).toHaveLength(4); // after the reopen
  });

  it("an exception in the loop releases the turn and the engine", async () => {
    const p = await project(files(4));
    const builder = p.requireAdapter(ProjectBuilder).configureEngine({ batchSize: 2 });
    builder.registerBuilder(echoBuilder([]));
    await expect(
      (async () => {
        for await (const step of builder.steps()) {
          if (step.kind === "batch") throw new Error("caller failed");
        }
      })(),
    ).rejects.toThrow("caller failed");
    expect((await builder.run()).executed).toBe(2);
  });

  it("a run stopped with break still records its changes: an absent builder catches up", async () => {
    const fs = new MemFilesApi();
    const p = await project({ "/proj/a.txt": "a" }, fs);
    const builder = p.requireAdapter(ProjectBuilder);
    const late: string[] = [];
    builder.registerBuilder(echoBuilder([]));
    const drop = builder.registerBuilder(echoBuilder(late, [], "Late", "late"));
    await builder.run();
    drop();
    await fs.write("/proj/b.txt", [enc.encode("b")]);
    for await (const step of builder.steps()) if (step.kind === "batch") break; // b.txt scanned
    builder.registerBuilder(echoBuilder(late, [], "Late", "late"));
    await builder.run();
    expect(late.sort()).toEqual(["a.txt", "a.txt", "b.txt"]); // caught up
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
