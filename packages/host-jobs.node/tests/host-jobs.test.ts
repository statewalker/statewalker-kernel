// host-jobs.node (statewalker-root#411): a fragment's scripts as jobs on a Node host, against a real
// system.tasks queue (SQLite in memory) and real processes.
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type SqlLike, TaskQueue } from "@statewalker/shared-tasks";
import {
  localQueueStore,
  type QueueStore,
  subscriptionName,
  taskSubject,
} from "@statewalker/system.tasks";
import { afterEach, describe, expect, it } from "vitest";
import {
  createHostJobs,
  HOST_JOBS_PRINCIPAL,
  type HostJobCommand,
  type HostJobs,
  hostJobScriptOf,
  processIdentity,
  resolveScript,
  ScriptRefusedError,
} from "../src/index.js";

const ARCHIVE = resolve(import.meta.dirname, "fixtures/archive");
const P = "local";
const FRAGMENT = "org.example.jobs";

function queueStore(): QueueStore {
  const db = new DatabaseSync(":memory:");
  const sql: SqlLike = {
    exec: (query, ...bindings) => {
      const rows = db.prepare(query).all(...(bindings as never[]));
      return { toArray: () => rows as Record<string, unknown>[] };
    },
  };
  return localQueueStore(new TaskQueue(sql), sql);
}

const running: HostJobs[] = [];
afterEach(async () => {
  for (const jobs of running.splice(0)) await jobs.stop();
});

/** The subscription system.tasks makes when the command's fragment is installed. */
async function installed(store: QueueStore, command: HostJobCommand) {
  await store.subscribe(
    P,
    { name: subscriptionName(command.command), filter: { subject: taskSubject(command.command) } },
    HOST_JOBS_PRINCIPAL,
  );
}

/** A host with these commands' fragments installed (their subscriptions made before it starts). */
function host(
  store: QueueStore,
  commands: HostJobCommand[],
  stateDir = mkdtempSync(join(tmpdir(), "host-jobs-")),
) {
  const jobs = createHostJobs({
    store,
    commands: () => commands,
    stateDir,
    graceMs: 300,
    waitMs: 50,
    syncMs: 50,
  });
  const start = jobs.start;
  const installing = Promise.all(commands.map((c) => installed(store, c)));
  const started: HostJobs = {
    ...jobs,
    async start() {
      await installing;
      await start();
    },
  };
  running.push(started);
  return { jobs: started, stateDir };
}

const command = (id: string, script: string): HostJobCommand => ({
  command: `${FRAGMENT}/${id}`,
  root: ARCHIVE,
  script,
});

/** Publishes a task of `id` and waits until its job has a reply; returns the job's log. */
async function run(store: QueueStore, id: string, payload: unknown = {}) {
  const task = await store.publish(
    P,
    { subject: taskSubject(`${FRAGMENT}/${id}`), payload },
    "user",
  );
  const job = await settled(store, task.id);
  return { task: task.id, ...job };
}

async function settled(store: QueueStore, task: string) {
  for (let i = 0; i < 200; i++) {
    const [job] = (await store.jobsOf(P, task)).filter((j) => j.reply !== undefined);
    if (job) {
      const log = await store.waitJob(P, job.job, HOST_JOBS_PRINCIPAL, { wait_ms: 0 });
      return { job: job.job, reply: job.reply as Record<string, unknown>, entries: log.entries };
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`task ${task} did not settle`);
}

const lines = (entries: { progress: unknown }[]) =>
  entries
    .map((e) => e.progress as { stream?: string; line?: string } | null)
    .filter((p) => p?.line !== undefined)
    .map((p) => `${p?.stream}: ${p?.line}`);

describe("host-jobs on a Node host", () => {
  it("runs a fragment's script per task: each output line in the job log, then done", async () => {
    const store = queueStore();
    const { jobs } = host(store, [command("count", "scripts/count.sh")]);
    await jobs.start();
    const { reply, entries } = await run(store, "count", { n: 3 });
    expect(reply).toMatchObject({ result: { exitCode: 0 } });
    expect(lines(entries)).toEqual([
      'stdout: params: {"n":3}',
      "stdout: line 1",
      "stdout: line 2",
      "stdout: line 3",
      "stderr: a warning",
    ]);
    expect(entries.at(-1)?.outcome).toBe("done");
  });

  it("ends a job whose script exits non-zero with an error and its stderr", async () => {
    const store = queueStore();
    const { jobs } = host(store, [command("fail", "scripts/fail.sh")]);
    await jobs.start();
    const task = await store.publish(P, { subject: taskSubject(`${FRAGMENT}/fail`) }, "user");
    // The queue retries it (3 attempts by default): the last attempt's reply is the error.
    let last: Awaited<ReturnType<typeof settled>> | undefined;
    for (let i = 0; i < 100; i++) {
      const jobsOf = await store.jobsOf(P, task.id);
      if (jobsOf.length === 3 && jobsOf.every((j) => j.reply !== undefined)) {
        last = await settled(store, task.id);
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(last?.reply.error).toMatch(/exit 3: it broke/);
    expect(lines(last?.entries ?? [])).toContain("stdout: about to fail");
    expect(last?.entries.at(-1)?.outcome).toBe("error");
  });

  it("terminates the process group on a cancel (SIGTERM, then SIGKILL) and ends it cancelled", async () => {
    const store = queueStore();
    const { jobs } = host(store, [command("wait", "scripts/wait.sh")]);
    await jobs.start();
    const task = await store.publish(P, { subject: taskSubject(`${FRAGMENT}/wait`) }, "user");
    // Both pids reported: the script's and its child's (which ignores SIGTERM).
    let pids: number[] = [];
    for (let i = 0; i < 100 && pids.length < 2; i++) {
      const [job] = await store.jobsOf(P, task.id);
      if (job) {
        const log = await store.waitJob(P, job.job, HOST_JOBS_PRINCIPAL, { wait_ms: 0 });
        pids = lines(log.entries)
          .map((l) => /^stdout: (?:child|self) (\d+)$/.exec(l)?.[1])
          .filter((p): p is string => p !== undefined)
          .map(Number);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(pids).toHaveLength(2);
    await store.cancel(P, task.id, "user");
    const { reply, entries } = await settled(store, task.id);
    expect(reply).toMatchObject({ cancelled: true });
    expect(entries.at(-1)?.outcome).toBe("cancelled");
    // (What the script prints after the SIGTERM is not logged: the queue takes no entries of a
    // cancelled task.)
    // The child ignoring SIGTERM is gone too, after the grace period.
    const alive = (pid: number) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let i = 0; i < 40 && pids.some(alive); i++) await new Promise((r) => setTimeout(r, 50));
    expect(pids.filter(alive)).toEqual([]);
  });

  it("refuses a script outside the fragment's archive, by path or through a link", () => {
    for (const script of ["../outside/evil.sh", "/bin/sh", "scripts/../../outside/evil.sh", ""])
      expect(() => resolveScript(ARCHIVE, script), script).toThrow(ScriptRefusedError);
    expect(() => resolveScript(ARCHIVE, "scripts/link.sh")).toThrow(
      /leaves the fragment's archive/,
    );
    expect(() => resolveScript(ARCHIVE, "scripts")).toThrow(/not a file/);
    expect(resolveScript(ARCHIVE, "scripts/count.sh")).toMatch(/count\.sh$/);
  });

  it("answers a task whose script leaves the archive with the refusal, running nothing", async () => {
    const store = queueStore();
    const { jobs } = host(store, [command("escape", "../outside/evil.sh")]);
    await jobs.start();
    const task = await store.publish(P, { subject: taskSubject(`${FRAGMENT}/escape`) }, "user");
    const { reply, entries } = await settled(store, task.id);
    expect(reply.error).toMatch(/leaves the fragment's archive: refused/);
    expect(reply.retry).toBeUndefined();
    expect(lines(entries)).toEqual([]);
  });

  it("after a restart, kills the processes left from before and ends their tasks cancelled", async () => {
    const store = queueStore();
    const stateDir = mkdtempSync(join(tmpdir(), "host-jobs-"));
    const first = host(store, [command("wait", "scripts/wait.sh")], stateDir).jobs;
    await first.start();
    const task = await store.publish(P, { subject: taskSubject(`${FRAGMENT}/wait`) }, "user");
    for (let i = 0; i < 100 && readdirSync(stateDir).length === 0; i++)
      await new Promise((r) => setTimeout(r, 50));
    const [file] = readdirSync(stateDir);
    expect(file).toBeDefined();
    // The host dies: its runner gone, its process left behind with its record.
    const record = JSON.parse(
      (await import("node:fs")).readFileSync(join(stateDir, file as string), "utf8"),
    ) as { pid: number };
    const { createHostJobs: again } = await import("../src/index.js");
    const second = again({ store, commands: () => [], stateDir, graceMs: 300, waitMs: 50 });
    running.push(second);
    await second.start();
    expect(readdirSync(stateDir)).toEqual([]);
    const alive = () => {
      try {
        process.kill(record.pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    for (let i = 0; i < 40 && alive(); i++) await new Promise((r) => setTimeout(r, 50));
    expect(alive()).toBe(false);
    const [job] = await store.jobsOf(P, task.id);
    const log = await store.waitJob(P, job?.job as string, HOST_JOBS_PRINCIPAL, { wait_ms: 0 });
    expect(log.entries.at(-1)?.outcome).toBe("cancelled");
  });

  it("reads a command's script from its operation", () => {
    expect(hostJobScriptOf({ operationId: "x", "x-host-job": { script: "scripts/a.sh" } })).toBe(
      "scripts/a.sh",
    );
    expect(hostJobScriptOf({ operationId: "x" })).toBeUndefined();
  });
});

// Merge gate pass 1 on statewalker/statewalker-kernel#83.
describe("host-jobs serves only installed fragments, and kills only its own processes", () => {
  it("runs nothing for a command whose fragment is not installed (no subscription)", async () => {
    const store = queueStore();
    const job = command("count", "scripts/count.sh");
    const jobs = createHostJobs({
      store,
      commands: () => [job],
      stateDir: mkdtempSync(join(tmpdir(), "host-jobs-")),
      waitMs: 50,
      syncMs: 50,
    });
    running.push(jobs);
    await jobs.start();
    // Its subject published to, with no subscription: nobody takes it, no job runs.
    const before = await store.publish(P, { subject: taskSubject(job.command) }, "user");
    await new Promise((r) => setTimeout(r, 300));
    expect(await store.jobsOf(P, before.id)).toEqual([]);
    // Installed: served from the next sync.
    await installed(store, job);
    const after = await run(store, "count", { n: 1 });
    expect(after.reply).toMatchObject({ result: { exitCode: 0 } });
    // Removed, its subscription with it: its runner stops, a task finds no one.
    await store.unsubscribe(P, subscriptionName(job.command));
    await new Promise((r) => setTimeout(r, 300));
    await installed(store, job);
    await store.unsubscribe(P, subscriptionName(job.command));
    const gone = await store.publish(P, { subject: taskSubject(job.command) }, "user");
    await new Promise((r) => setTimeout(r, 300));
    expect(await store.jobsOf(P, gone.id)).toEqual([]);
  });

  it("leaves a process alone whose pid a stale record names (another boot or start)", async () => {
    const store = queueStore();
    const stateDir = mkdtempSync(join(tmpdir(), "host-jobs-"));
    // A process group this test owns, standing for an unrelated one that reused the pid.
    const { spawn } = await import("node:child_process");
    const { writeFileSync } = await import("node:fs");
    const other = spawn("bash", ["-c", "sleep 30"], { detached: true, stdio: "ignore" });
    const pid = other.pid as number;
    try {
      expect(processIdentity(pid)).toBeDefined();
      const task = await store.publish(P, { subject: "fragments.org.example.jobs.stale" }, "user");
      writeFileSync(
        join(stateDir, "stale.json"),
        JSON.stringify({ pid, task: task.id, command: "x/y", identity: "another-boot:1" }),
      );
      const jobs = createHostJobs({ store, commands: () => [], stateDir, waitMs: 50 });
      running.push(jobs);
      await jobs.start();
      expect(readdirSync(stateDir)).toEqual([]);
      expect(() => process.kill(pid, 0)).not.toThrow();
    } finally {
      process.kill(-pid, "SIGKILL");
    }
  });
});
