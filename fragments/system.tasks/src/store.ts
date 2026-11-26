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
  /** The queue API as `reader` (the runners' claims, renewals, acks and replies). */
  api(
    reader: QueueReaderData,
  ): Pick<TasksApi, "claim" | "renew" | "ack" | "release" | "reply" | "changes">;
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

/** The queue in this process. */
export function localQueueStore(queue: TaskQueue): QueueStore {
  return {
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
  return localQueueStore(new TaskQueue(sql, options));
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
export function serveQueueStore(queue: TaskQueue): (operation: unknown) => Promise<unknown> {
  const local = localQueueStore(queue);
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
