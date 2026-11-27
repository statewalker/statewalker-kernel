// host-jobs.node (statewalker-root#411; ADR 2026-11-23-commands-tasks-and-jobs, decision 6): the
// processor behind the `host-jobs` binding a CellB Node host offers. A fragment that requires the
// binding ships scripts in its archive and declares commands that run them, exposed as `task`:
//
//   { "point": "commands", "data": { "operation": { "operationId": "count", "x-host-job":
//     { "script": "scripts/count.sh" } }, "exposures": { "task": {} } } }
//
// Each task of such a command is one OS process, one job per lease: the task's payload as JSON in
// `JOB_PARAMS`, each stdout and stderr line a job-log entry (`{ stream, line }`), the exit status
// the job's end (0: `done`, the reply `{ exitCode: 0 }`; anything else: `error`). A cancel sends
// SIGTERM to the process group, then SIGKILL after a grace period, and the job ends `cancelled`.
// After a host restart, processes left from before are killed and their tasks end `cancelled`.
//
// Ported from statewalker-sandbox's JobManager (apps/jobs-manager): its process groups, the grace
// period, line-by-line output and orphan clean-up; its REST, SSE, MCP and CLI surfaces are not:
// commands and their exposures replace them. Only scripts shipped inside a fragment's installed
// archive run (ADR 2026-11-19-code-kinds-and-trust): a script path that leaves it is refused.
import { type ChildProcess, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join, sep } from "node:path";
import { createInterface } from "node:readline";
import type { Lease, Processor, ProcessorContext } from "@statewalker/shared-tasks";
import { serveSubscription } from "@statewalker/shared-tasks";
import {
  type QueueStore,
  subscriptionName,
  TASKS_PRINCIPAL,
  TASKS_PROJECT,
} from "@statewalker/system.tasks";

/** The binding a Node host offers, and a fragment requires to run its scripts here. */
export const HOST_JOBS_BINDING = "host-jobs";

/**
 * The principal host-jobs holds its subscriptions and leases as: system.tasks' own, as it serves
 * the same host's queue for system.tasks, so its `jobs` and `job` read these jobs as any other,
 * and a fragment's removal removes their subscriptions too.
 */
export const HOST_JOBS_PRINCIPAL = TASKS_PRINCIPAL;

/** A command that runs a script of its fragment: `<fragment-id>/<command-id>`, its script. */
export interface HostJobCommand {
  /** `<fragment-id>/<command-id>`. */
  readonly command: string;
  /** The fragment's installed archive: its root folder on this host. */
  readonly root: string;
  /** The script, relative to `root`. */
  readonly script: string;
}

/** A script refused: it leaves its fragment's archive, or is not a file there. */
export class ScriptRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScriptRefusedError";
  }
}

/** The interpreter of a script by its extension; a script with none is executed itself. */
const LAUNCHERS: Record<string, string[]> = {
  js: ["node"],
  mjs: ["node"],
  py: ["python3"],
  sh: ["bash"],
};

/**
 * The script's real path, inside its fragment's archive: refuses an absolute path, one that
 * climbs out (`..`), or a link that leads out (both sides resolved), and anything not a file.
 */
export function resolveScript(root: string, script: string): string {
  if (!script || script.startsWith("/") || script.includes("\\") || script.includes("\0"))
    throw new ScriptRefusedError(`"${script}" is not a path inside the fragment's archive`);
  let base: string;
  let real: string;
  try {
    base = realpathSync(root);
    real = realpathSync(join(base, script));
  } catch {
    throw new ScriptRefusedError(`"${script}" is not in the fragment's archive`);
  }
  if (!real.startsWith(base + sep))
    throw new ScriptRefusedError(`"${script}" leaves the fragment's archive: refused`);
  if (!statSync(real).isFile())
    throw new ScriptRefusedError(`"${script}" is not a file in the fragment's archive`);
  return real;
}

/** The `x-host-job` script of a command's operation, or undefined for a command that has none. */
export function hostJobScriptOf(operation: unknown): string | undefined {
  const job = (operation as { "x-host-job"?: { script?: unknown } } | undefined)?.["x-host-job"];
  return typeof job?.script === "string" ? job.script : undefined;
}

export interface HostJobsOptions {
  /** The host's system.tasks queue (its fragment DO's, through its server half). */
  readonly store: QueueStore;
  /** The commands that run scripts, of the installed fragments requiring the binding. */
  readonly commands: () => readonly HostJobCommand[];
  /**
   * Where the running processes are recorded, so a restart finds those left from before (a
   * folder of this host's data). Created as needed.
   */
  readonly stateDir: string;
  /** Between SIGTERM and SIGKILL on a cancel (5 s). */
  readonly graceMs?: number;
  /**
   * How often a running job renews its lease while its script prints nothing (1 s): a cancel is
   * learnt at a renew, so this bounds how long a cancelled script runs on.
   */
  readonly heartbeatMs?: number;
  /** How often the installed fragments' subscriptions are looked at again (2 s). */
  readonly syncMs?: number;
  /** How long one wait for a change lasts in a runner (30 s). */
  readonly waitMs?: number;
  /** The environment the scripts start from (the host's own by default; `JOB_*` added). */
  readonly env?: NodeJS.ProcessEnv;
  readonly onError?: (error: unknown) => void;
}

export interface HostJobs {
  /** Ends the jobs of a previous run, then serves the commands' subscriptions. */
  start(): Promise<void>;
  /**
   * Serves the commands of installed fragments now (their subscriptions exist); `start()` also
   * does it every `syncMs`.
   */
  sync(): Promise<void>;
  /** Stops serving: running processes are terminated as on a cancel. */
  stop(): Promise<void>;
}

interface Running {
  readonly pid: number;
  readonly task: string;
  readonly command: string;
  /** The machine's boot and the process's start, so a reused pid is never taken for it. */
  readonly identity?: string;
}

/**
 * Who `pid` is: this boot's id and the process's start time (Linux `/proc`), or undefined where
 * that cannot be read. A pid reused after a reboot or a restart has another identity.
 */
export function processIdentity(pid: number): string | undefined {
  try {
    const boot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // Field 22 (starttime), counted after the command's closing parenthesis (it may hold spaces).
    const start = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    return boot && start ? `${boot}:${start}` : undefined;
  } catch {
    return undefined;
  }
}

export function createHostJobs(options: HostJobsOptions): HostJobs {
  const graceMs = options.graceMs ?? 5_000;
  const onError = options.onError ?? (() => {});
  const P = TASKS_PROJECT;
  const own = { id: HOST_JOBS_PRINCIPAL, destinations: [], admin: true };
  const runners = new Map<string, { stop: AbortController; done: Promise<void> }>();
  let resync: ReturnType<typeof setInterval> | undefined;
  mkdirSync(options.stateDir, { recursive: true });
  const recordOf = (lease: string) =>
    join(options.stateDir, `${lease.replace(/[^\w.-]/g, "_")}.json`);

  /** SIGTERM to the process group, SIGKILL after the grace period (its children may ignore it). */
  function terminate(child: ChildProcess): void {
    const signal = (sig: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, sig);
      } catch {
        // the group is gone
      }
    };
    signal("SIGTERM");
    setTimeout(() => signal("SIGKILL"), graceMs).unref();
  }

  function processorOf(job: HostJobCommand): Processor {
    return {
      async run(lease, context) {
        // The task's job index (system.tasks' `jobs`): a viewer finds this attempt's log by it.
        await options.store.recordJob(P, lease.task.id, lease.id).catch(onError);
        try {
          const result = await runScript(job, lease, context);
          await options.store.recordReply(P, lease.id, { job: lease.id, result }).catch(onError);
          return result;
        } catch (error) {
          const cancelled =
            (context.signal.reason as { code?: unknown } | undefined)?.code === "ECANCELED";
          await options.store
            .recordReply(
              P,
              lease.id,
              cancelled
                ? { job: lease.id, cancelled: true }
                : context.signal.aborted
                  ? { job: lease.id, error: "the attempt stopped", retry: true }
                  : {
                      job: lease.id,
                      error: String((error as Error)?.message ?? error),
                      // A refused script is refused at every attempt: no retry is announced.
                      ...(lease.attempt < lease.max_attempts &&
                      !(error instanceof ScriptRefusedError)
                        ? { retry: true }
                        : {}),
                    },
            )
            .catch(onError);
          throw error;
        }
      },
    };
  }

  async function runScript(
    job: HostJobCommand,
    lease: Lease,
    context: ProcessorContext,
  ): Promise<{ exitCode: 0 }> {
    const script = resolveScript(job.root, job.script);
    const prefix = LAUNCHERS[extname(script).slice(1)] ?? [];
    const [command, ...args] = [...prefix, script];
    const child = spawn(command as string, args, {
      cwd: realpathSync(job.root),
      env: {
        ...(options.env ?? process.env),
        JOB_ID: lease.id,
        JOB_TASK: lease.task.id,
        JOB_PARAMS: JSON.stringify(lease.task.payload ?? {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group: a cancel reaches the script's children too.
      detached: true,
    });
    const exited = new Promise<{ code: number | null; signal: string | null; error?: Error }>(
      (resolve) => {
        child.once("error", (error) => resolve({ code: null, signal: null, error }));
        child.once("close", (code, signal) => resolve({ code, signal }));
      },
    );
    if (child.pid)
      writeFileSync(
        recordOf(lease.id),
        JSON.stringify({
          pid: child.pid,
          task: lease.task.id,
          command: job.command,
          ...(processIdentity(child.pid) ? { identity: processIdentity(child.pid) } : {}),
        } satisfies Running),
      );
    // A renew without an entry: the queue's cancel reaches a quiet script too.
    const heartbeat = setInterval(
      () => void context.progress(undefined).catch(() => {}),
      options.heartbeatMs ?? 1_000,
    );
    const onAbort = () => terminate(child);
    if (context.signal.aborted) onAbort();
    else context.signal.addEventListener("abort", onAbort, { once: true });
    // The readers attach at once: a fast script's output is never lost.
    const tail: string[] = [];
    const read = (stream: NodeJS.ReadableStream | null, name: "stdout" | "stderr") =>
      (async () => {
        if (!stream) return;
        for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
          if (name === "stderr") {
            tail.push(line);
            if (tail.length > 20) tail.shift();
          }
          await context.progress({ stream: name, line }).catch(onError);
        }
      })();
    try {
      const outputs = Promise.allSettled([
        read(child.stdout, "stdout"),
        read(child.stderr, "stderr"),
      ]);
      const exit = await exited;
      await outputs;
      if (context.signal.aborted) throw context.signal.reason;
      if (exit.error) throw new Error(`${job.command}: ${exit.error.message}`);
      if (exit.code === 0) return { exitCode: 0 };
      throw new Error(
        `${job.command}: ${exit.signal ? `killed by ${exit.signal}` : `exit ${exit.code}`}${
          tail.length ? `: ${tail.join("\n")}` : ""
        }`,
      );
    } finally {
      clearInterval(heartbeat);
      context.signal.removeEventListener("abort", onAbort);
      rmSync(recordOf(lease.id), { force: true });
    }
  }

  async function serve(job: HostJobCommand, stop: AbortController): Promise<void> {
    const name = subscriptionName(job.command);
    if (stop.signal.aborted) return;
    await serveSubscription(options.store.api(own), {
      project: P,
      subscription: name,
      processor: processorOf(job),
      signal: stop.signal,
      ...(options.waitMs !== undefined ? { waitMs: options.waitMs } : {}),
      onError,
    });
  }

  /**
   * Serves exactly the commands whose fragment is installed: those whose subscription the
   * platform's system.tasks made when the fragment was installed (it removes it with the
   * fragment). A command of a fragment not installed runs nothing, whoever publishes to it.
   */
  async function sync(): Promise<void> {
    const subscribed = new Set(
      (await options.store.listSubscriptions(P))
        .filter((s) => !s.inbox && s.owner === HOST_JOBS_PRINCIPAL)
        .map((s) => s.name),
    );
    const live = new Map(
      options
        .commands()
        .filter((c) => subscribed.has(subscriptionName(c.command)))
        .map((c) => [c.command, c]),
    );
    for (const [command, runner] of runners) {
      if (live.has(command)) continue;
      runner.stop.abort();
      runners.delete(command);
    }
    for (const [command, job] of live) {
      if (runners.has(command)) continue;
      const stop = new AbortController();
      const done = serve(job, stop).catch((error: unknown) => {
        if (runners.get(command)?.stop === stop) runners.delete(command);
        onError(error);
      });
      runners.set(command, { stop, done });
    }
  }

  /**
   * The jobs a previous run of this host left (its process records): each process group still
   * there is killed, and its task cancelled, so the job ends `cancelled` and is not run again.
   */
  async function recover(): Promise<void> {
    if (!existsSync(options.stateDir)) return;
    for (const file of readdirSync(options.stateDir)) {
      if (!file.endsWith(".json")) continue;
      const path = join(options.stateDir, file);
      try {
        const record = JSON.parse(readFileSync(path, "utf8")) as Running;
        // Only the very process this host started (same boot, same start time): a pid reused
        // since (a reboot, a restart) belongs to someone else, and is left alone.
        const ours =
          record.pid > 1 &&
          record.identity !== undefined &&
          processIdentity(record.pid) === record.identity;
        try {
          if (ours) process.kill(-record.pid, "SIGKILL");
        } catch {
          // already gone
        }
        await options.store.cancel(P, record.task, HOST_JOBS_PRINCIPAL, { admin: true });
      } catch (error) {
        onError(error);
      } finally {
        rmSync(path, { force: true });
      }
    }
  }

  return {
    async start() {
      await recover();
      await sync();
      // Installs and removals reach the host through the queue: looked at again periodically.
      resync = setInterval(() => void sync().catch(onError), options.syncMs ?? 2_000);
      resync.unref?.();
    },
    sync,
    async stop() {
      if (resync) clearInterval(resync);
      const done = [...runners.values()];
      for (const { stop } of done) stop.abort();
      runners.clear();
      await Promise.allSettled(done.map((r) => r.done));
    },
  };
}
