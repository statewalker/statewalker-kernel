// Where system.tasks' queue lives (statewalker-root#409): in this process (`localQueueStore`, a
// `TaskQueue` over any `SqlLike`: SQLite in memory headless), or in the fragment's DO, its SQL
// storage the queue's, reached through its server half (`remoteQueueStore` in the client half,
// `serveQueueStore` in the DO). Every operation system.tasks makes is one of these, asynchronous,
// so the client half holds no queue state of its own: tasks and job logs outlive a reload, and the
// DO outlives the page.
import {
  type JobLog,
  type Lease,
  type QueueReader,
  queueApi,
  type SqlLike,
  type Subscription,
  type SubscriptionInput,
  type Task,
  type TaskInput,
  TaskQueue,
  type TaskQueueOptions,
  type TasksApi,
} from "@statewalker/shared-tasks";

/** A reader as it crosses to the DO: its `may` (a function) never does; its absence allows all. */
export type QueueReaderData = Omit<QueueReader, "may">;

/** The queue operations system.tasks makes, asynchronous wherever the queue is. */
export interface QueueStore {
  changeSeq(project: string): Promise<number>;
  waitChange(project: string, after: number | undefined, waitMs: number): Promise<number>;
  publish(project: string, input: TaskInput, sender: string): Promise<Task>;
  subscribe(project: string, input: SubscriptionInput, owner: string): Promise<Subscription>;
  createInbox(project: string, owner: string): Promise<Subscription>;
  listSubscriptions(project: string): Promise<Subscription[]>;
  unsubscribe(project: string, name: string): Promise<void>;
  take(
    project: string,
    name: string,
    reader: QueueReaderData,
    options?: { limit?: number },
  ): Promise<Task[]>;
  reply(
    project: string,
    taskId: string,
    holder: string,
    input: { payload?: unknown },
  ): Promise<Task>;
  cancel(project: string, taskId: string, by: string, options?: { admin?: boolean }): Promise<void>;
  waitJob(
    project: string,
    id: string,
    reader: string,
    options?: { after?: number; wait_ms?: number },
  ): Promise<JobLog>;
  /** Note that `job` (a lease's job log) runs `task`: the first entry of the task's job index. */
  recordJob(project: string, task: string, job: string): Promise<void>;
  /** Note the reply `job` ended with (the runner's: `{ job, result }`, `{ job, error }`, ...). */
  recordReply(project: string, job: string, reply: unknown): Promise<void>;
  /** The jobs that ran `task`, oldest first, each with its reply once it has one. */
  jobsOf(project: string, task: string): Promise<TaskJob[]>;
  /** The queue API as `reader` (the runners' claims, renewals, acks and replies). */
  api(
    reader: QueueReaderData,
  ): Pick<TasksApi, "claim" | "renew" | "ack" | "release" | "reply" | "changes">;
}

/** One job of a task, as system.tasks indexes them: what `system.tasks/jobs` answers. */
export interface TaskJob {
  readonly job: string;
  /** When the job started, in the queue's clock (epoch ms). */
  readonly at: number;
  /** The reply it ended with, once it has ended. */
  readonly reply?: unknown;
}

/** The most jobs one task's index keeps (its attempts): the oldest go first. */
const MAX_JOBS_PER_TASK = 20;
/** A reply's cap in the index, as JSON: a larger one is kept as its error. */
const MAX_REPLY_BYTES = 64 * 1024;

/** system.tasks' index of jobs by task. */
interface JobIndex {
  recordJob(project: string, task: string, job: string): void;
  recordReply(project: string, job: string, reply: unknown): void;
  jobsOf(project: string, task: string): TaskJob[];
}

/** The job index in `sql` beside the queue (its own table). */
function sqlJobIndex(sql: SqlLike, now: () => number): JobIndex {
  sql.exec(
    "CREATE TABLE IF NOT EXISTS system_tasks_jobs (project TEXT NOT NULL, task TEXT NOT NULL, job TEXT NOT NULL PRIMARY KEY, at INTEGER NOT NULL, reply TEXT)",
  );
  sql.exec(
    "CREATE INDEX IF NOT EXISTS system_tasks_jobs_task ON system_tasks_jobs (project, task, at)",
  );
  return {
    recordJob(project, task, job) {
      sql.exec(
        "INSERT OR IGNORE INTO system_tasks_jobs (project, task, job, at) VALUES (?, ?, ?, ?)",
        project,
        task,
        job,
        now(),
      );
      sql.exec(
        "DELETE FROM system_tasks_jobs WHERE project = ? AND task = ? AND job NOT IN (SELECT job FROM system_tasks_jobs WHERE project = ? AND task = ? ORDER BY at DESC LIMIT ?)",
        project,
        task,
        project,
        task,
        MAX_JOBS_PER_TASK,
      );
    },
    recordReply(project, job, reply) {
      let text = JSON.stringify(reply ?? null);
      if (new TextEncoder().encode(text).length > MAX_REPLY_BYTES)
        text = JSON.stringify({ job, error: "the reply is larger than the index keeps" });
      sql.exec(
        "UPDATE system_tasks_jobs SET reply = ? WHERE project = ? AND job = ?",
        text,
        project,
        job,
      );
    },
    jobsOf(project, task) {
      return sql
        .exec(
          "SELECT job, at, reply FROM system_tasks_jobs WHERE project = ? AND task = ? ORDER BY at, job",
          project,
          task,
        )
        .toArray()
        .map((row) => ({
          job: String(row.job),
          at: Number(row.at),
          ...(typeof row.reply === "string" ? { reply: JSON.parse(row.reply) } : {}),
        }));
    },
  };
}

/** The store's operations that cross to the DO, by name. */
const QUEUE_METHODS = [
  "changeSeq",
  "waitChange",
  "publish",
  "subscribe",
  "createInbox",
  "listSubscriptions",
  "unsubscribe",
  "take",
  "reply",
  "cancel",
  "waitJob",
  "recordJob",
  "recordReply",
  "jobsOf",
] as const;
const API_METHODS = ["claim", "renew", "ack", "release", "reply", "changes"] as const;
type QueueMethod = (typeof QUEUE_METHODS)[number];
type ApiMethod = (typeof API_METHODS)[number];

/** One operation as it crosses to the DO: JSON both ways. */
export type QueueOperation =
  | { readonly kind: "queue"; readonly method: QueueMethod; readonly args: readonly unknown[] }
  | {
      readonly kind: "api";
      readonly reader: QueueReaderData;
      readonly method: ApiMethod;
      readonly args: readonly unknown[];
    };

/**
 * The queue in this process, its job index in `sql` (the queue's own database) or, without one,
 * in memory.
 */
export function localQueueStore(
  queue: TaskQueue,
  sql?: SqlLike,
  now: () => number = Date.now,
): QueueStore {
  const index = sql ? sqlJobIndex(sql, now) : memoryJobIndex(now);
  return {
    recordJob: async (p, task, job) => index.recordJob(p, task, job),
    recordReply: async (p, job, reply) => index.recordReply(p, job, reply),
    jobsOf: async (p, task) => index.jobsOf(p, task),
    changeSeq: async (p) => queue.changeSeq(p),
    waitChange: (p, after, waitMs) => queue.waitChange(p, after, waitMs),
    publish: async (p, input, sender) => queue.publish(p, input, sender),
    subscribe: async (p, input, owner) => queue.subscribe(p, input, owner),
    createInbox: async (p, owner) => queue.createInbox(p, owner),
    listSubscriptions: async (p) => queue.listSubscriptions(p),
    unsubscribe: async (p, name) => queue.unsubscribe(p, name),
    take: async (p, name, reader, options) => queue.take(p, name, reader, options),
    reply: async (p, task, holder, input) => queue.reply(p, task, holder, input),
    cancel: async (p, task, by, options) => queue.cancel(p, task, by, options),
    waitJob: (p, id, reader, options) => queue.waitJob(p, id, reader, options),
    api: (reader) => queueApi(queue, reader),
  };
}

/** A queue over `sql`, in this process: the DO's, or SQLite in memory. */
export function sqlQueueStore(sql: SqlLike, options: TaskQueueOptions = {}): QueueStore {
  return localQueueStore(new TaskQueue(sql, options), sql, options.now ?? Date.now);
}

/** The job index in memory, for a queue whose database is not at hand. */
function memoryJobIndex(now: () => number): JobIndex {
  const jobs = new Map<
    string,
    { project: string; task: string; job: string; at: number; reply?: unknown }
  >();
  return {
    recordJob(project, task, job) {
      if (!jobs.has(job)) jobs.set(job, { project, task, job, at: now() });
      const mine = [...jobs.values()]
        .filter((j) => j.project === project && j.task === task)
        .sort((x, y) => y.at - x.at);
      for (const old of mine.slice(MAX_JOBS_PER_TASK)) jobs.delete(old.job);
    },
    recordReply(project, job, reply) {
      const found = jobs.get(job);
      if (found && found.project === project)
        found.reply = JSON.parse(JSON.stringify(reply ?? null));
    },
    jobsOf(project, task) {
      return [...jobs.values()]
        .filter((j) => j.project === project && j.task === task)
        .sort((x, y) => x.at - y.at || x.job.localeCompare(y.job))
        .map(({ job, at, reply }) => ({ job, at, ...(reply !== undefined ? { reply } : {}) }));
    },
  };
}

/** A refused operation as it crosses back: its message and the queue's code (`ECANCELED`, ...). */
export interface QueueErrorData {
  readonly error: string;
  readonly code?: string;
}

/** An error as JSON carries it: the runner tells a cancellation by its `code`, so it is kept. */
export function queueErrorToData(error: unknown): QueueErrorData {
  const code = (error as { code?: unknown })?.code;
  return {
    error: String((error as Error)?.message ?? error),
    ...(typeof code === "string" ? { code } : {}),
  };
}

/** And back: an `Error` with the queue's `code`, as the queue in this process throws it. */
export function queueErrorFromData(data: QueueErrorData): Error & { code?: string } {
  const error = new Error(data.error) as Error & { code?: string };
  if (typeof data.code === "string") error.code = data.code;
  return error;
}

/** Why an operation was refused before it reached the queue. */
export class QueueOperationError extends Error {
  override name = "QueueOperationError";
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/**
 * The DO's side: runs one operation (as JSON) on its queue. Only the store's named methods run,
 * never anything else of the queue; their own checks (rights, sizes) apply as in this process.
 */
export function serveQueueStore(local: QueueStore): (operation: unknown) => Promise<unknown> {
  return async (operation) => {
    if (!isRecord(operation) || !Array.isArray(operation.args))
      throw new QueueOperationError("an operation is { kind, method, args }");
    const { kind, method, args } = operation;
    if (kind === "queue" && (QUEUE_METHODS as readonly unknown[]).includes(method)) {
      const run = local[method as QueueMethod] as (...a: unknown[]) => Promise<unknown>;
      return run(...unwire(args));
    }
    if (kind === "api" && (API_METHODS as readonly unknown[]).includes(method)) {
      const reader = operation.reader;
      if (
        !isRecord(reader) ||
        typeof reader.id !== "string" ||
        !Array.isArray(reader.destinations) ||
        !reader.destinations.every((d) => typeof d === "string")
      )
        throw new QueueOperationError("a reader is { id, destinations, admin? }");
      const api = local.api({
        id: reader.id,
        destinations: reader.destinations as string[],
        ...(reader.admin === true ? { admin: true } : {}),
      }) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
      return (api[method as ApiMethod] as (...a: unknown[]) => Promise<unknown>)(...unwire(args));
    }
    throw new QueueOperationError(`no queue operation '${String(kind)}.${String(method)}'`);
  };
}

/** Arguments as JSON carries them: an absent one (`undefined`) as `null`, its position kept. */
const wire = (args: readonly unknown[]) => args.map((a) => (a === undefined ? null : a));
/** And back: no operation takes `null` where it takes an absent argument. */
const unwire = (args: readonly unknown[]) => args.map((a) => (a === null ? undefined : a));

/** The queue in the fragment's DO, through `send` (one operation, its JSON answer). */
export function remoteQueueStore(
  send: (operation: QueueOperation) => Promise<unknown>,
): QueueStore {
  const queue =
    (method: QueueMethod) =>
    (...args: unknown[]) =>
      send({ kind: "queue", method, args: wire(args) });
  const store = Object.fromEntries(QUEUE_METHODS.map((m) => [m, queue(m)])) as unknown as Omit<
    QueueStore,
    "api"
  >;
  return {
    ...store,
    api: (reader) =>
      Object.fromEntries(
        API_METHODS.map((method) => [
          method,
          (...args: unknown[]) => send({ kind: "api", reader, method, args: wire(args) }),
        ]),
      ) as unknown as ReturnType<QueueStore["api"]>,
  };
}

/** The ways the store's answers come back through JSON: leases' and tasks' shapes are JSON. */
export type { JobLog, Lease, Subscription, Task };
