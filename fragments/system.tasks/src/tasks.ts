// system.tasks (statewalker-root ADR 2026-11-23-commands-tasks-and-jobs): the host's one task
// queue, and the `task` exposure. Every command exposed as `task` gets a subscription on
// `fragments.<fragment-id>.<command-id>`; while the command is live a runner serves it, turning
// each lease into a bus call (the task id as `callId`, the lease's signal, progress written to the
// job log, the output as the reply). The subscription outlives a deactivation, so tasks wait for
// the fragment's return, and leaves with the fragment's removal.
//
// Tasks carry their publisher: `user` for the user and system code, `capability:<c>` for a caller
// that went through the gate. A task a gated caller published runs only if the gate lets that
// caller run the command, as a direct call would be decided.
import {
  type ActivationContext,
  type AspectCleanup,
  installedFragmentsSlot,
} from "@statewalker/kernel.core";
import type { Slots } from "@statewalker/shared-slots";
import {
  type Processor,
  type QueueReader,
  queueApi,
  type SqlLike,
  serveSubscription,
  subjectMatches,
  TaskQueue,
  type TaskQueueOptions,
} from "@statewalker/shared-tasks";
import type {
  Caller,
  CallGate,
  CommandBus,
  CommandContext,
  CommandEntry,
  SystemCommands,
} from "@statewalker/system.commands";

/** The queue's project: one queue per host. */
export const TASKS_PROJECT = "local";

/** The principal system.tasks holds leases and subscriptions as. */
export const TASKS_PRINCIPAL = "system:tasks";

/** The subject that runs the command `<fragment-id>/<command-id>`. */
export function taskSubject(command: string): string {
  return `fragments.${command.replace("/", ".")}`;
}

/** The subscription serving the command `<fragment-id>/<command-id>` (no `/` in a name). */
export function subscriptionName(command: string): string {
  return command.replace("/", ".");
}

/** The fragment a subscription of system.tasks serves (its name up to the last `.`). */
function fragmentOf(name: string): string {
  return name.slice(0, name.lastIndexOf("."));
}

const USER = "user";
const CAPABILITY = "capability:";
const MAX_WAIT_MS = 60_000;
const CORRELATION = /^[^\s]{1,128}$/;

const isUser = (caller: Caller) => "kind" in caller && caller.kind === "user";

/** The principal a caller publishes and reads as. */
function principalOf(caller: Caller): string {
  return isUser(caller) ? USER : `${CAPABILITY}${(caller as { capability: string }).capability}`;
}

/** The caller a task runs for, from its publisher; undefined for one system.tasks did not stamp. */
function callerOf(sender: string): Caller | undefined {
  if (sender === USER) return { kind: "user" };
  if (sender.startsWith(CAPABILITY)) return { capability: sender.slice(CAPABILITY.length) };
  return undefined;
}

export interface SystemTasksOptions {
  /** system.commands' bus: the commands it serves, and its own. */
  readonly commands: CommandBus;
  /**
   * system.commands' `callAs`: runs a task's command for its publisher, the gate already asked,
   * with the task's id as `callId`. The host passes it; fragments never get it.
   */
  readonly callAs: SystemCommands["callAs"];
  /** The kernel's slots: a fragment's removal removes its subscriptions. */
  readonly slots: Slots;
  /** Where the queue lives: the fragment DO's SQL storage, or SQLite in memory headless. */
  readonly sql: SqlLike;
  /** system.security's gate: decides, when they run, the tasks gated callers published. */
  readonly gate?: CallGate;
  /** The queue's clock, ids and limits. */
  readonly queue?: TaskQueueOptions;
  /** The lease of a subscription it creates (the queue's default: 5 minutes). */
  readonly leaseMs?: number;
  /** The attempts of a subscription it creates (the queue's default: 3). */
  readonly maxAttempts?: number;
  /** How long one wait for a change lasts, in runners and waiting publishers (30 s). */
  readonly waitMs?: number;
  /** Reports what fails outside a call: a runner's lost lease, a reply refused. */
  readonly onError?: (error: unknown) => void;
}

/** The handlers of the fragment's commands, as its extensions' references name them. */
export interface SystemTasksModule {
  readonly publish: (
    input: { subject: string; payload?: unknown; wait?: boolean },
    context: CommandContext,
  ) => Promise<Record<string, unknown>>;
  readonly cancel: (input: { task: string }, context: CommandContext) => { cancelled: true };
  readonly job: (
    input: { job: string; after?: number; wait_ms?: number },
    context: CommandContext,
  ) => Promise<unknown>;
  readonly [name: string]: unknown;
}

/** The system.tasks fragment's code: its queue, its module, and its client activator body. */
export interface SystemTasks {
  readonly queue: TaskQueue;
  /** The fragment's module: what its own extensions' references (`./index.js`) resolve to. */
  readonly module: SystemTasksModule;
  /** Activate the client aspect: serve the task-exposed commands. Returns the cleanup. */
  activate(context: ActivationContext): AspectCleanup;
}

export function createSystemTasks(options: SystemTasksOptions): SystemTasks {
  const { commands, callAs, slots, gate } = options;
  const onError = options.onError ?? (() => {});
  const waitMs = options.waitMs ?? 30_000;
  const queue = new TaskQueue(options.sql, options.queue ?? {});
  const P = TASKS_PROJECT;
  const own: QueueReader = { id: TASKS_PRINCIPAL, destinations: [], admin: true };
  const api = queueApi(queue, own);
  const runners = new Map<string, AbortController>();
  // The running tasks of this host: a cancel makes each one's runner renew at once, so the
  // queue's "cancelled" reaches its handler without waiting for the next renew.
  const running = new Map<string, () => void>();

  function cancelTask(task: string, by: string, admin: boolean): void {
    queue.cancel(P, task, by, { admin });
    running.get(task)?.();
  }

  /** Ends a task for good with an error: its reply (when it asks for one), then a cancel. */
  function refuse(task: string, replyTo: string | undefined, job: string, error: unknown): void {
    const message = String((error as Error)?.message ?? error);
    try {
      if (replyTo) queue.reply(P, task, TASKS_PRINCIPAL, { payload: { job, error: message } });
      cancelTask(task, TASKS_PRINCIPAL, true);
    } catch (e) {
      onError(e);
    }
  }

  function processorOf(id: string): Processor {
    return {
      async run(lease, context) {
        const entry: CommandEntry | undefined = commands.get(id);
        if (!entry) throw new Error(`${id} is not live`);
        const caller = callerOf(lease.task.sender);
        if (!caller) throw new Error(`a task from '${lease.task.sender}' runs no command`);
        const payload = lease.task.payload ?? {};
        if (!isUser(caller)) {
          try {
            if (!gate)
              throw new Error(`forbidden: ${id}: no gate decides tasks from gated callers`);
            await gate({
              command: entry,
              caller: caller as Exclude<Caller, { kind: "user" }>,
              input: payload,
            });
          } catch (refusal) {
            // A refusal is final: the publisher gets it now, and the task is not tried again
            // (nor the user asked again for an approval).
            refuse(lease.task.id, lease.task.reply_to, lease.id, refusal);
            throw refusal;
          }
        }
        running.set(lease.task.id, () => void context.progress(null).catch(() => {}));
        try {
          // As its publisher: the handler sees the caller the gate let through.
          return await callAs(caller, id, payload, {
            callId: lease.task.id,
            signal: context.signal,
            onProgress: (entry) => context.progress(entry),
          });
        } finally {
          running.delete(lease.task.id);
        }
      },
    };
  }

  function serve(entry: CommandEntry): void {
    const name = subscriptionName(entry.id);
    if (!queue.listSubscriptions(P).some((s) => s.name === name))
      queue.subscribe(
        P,
        {
          name,
          filter: { subject: taskSubject(entry.id) },
          ...(options.leaseMs !== undefined ? { lease_ms: options.leaseMs } : {}),
          ...(options.maxAttempts !== undefined ? { max_attempts: options.maxAttempts } : {}),
        },
        TASKS_PRINCIPAL,
      );
    const stop = new AbortController();
    runners.set(entry.id, stop);
    serveSubscription(api, {
      project: P,
      subscription: name,
      processor: processorOf(entry.id),
      signal: stop.signal,
      waitMs,
      onError,
    }).catch(onError);
  }

  /** Serve exactly the live task-exposed commands; a runner stops, its subscription stays. */
  function sync(entries: readonly CommandEntry[]): void {
    const live = new Map(entries.filter((e) => e.exposures.task).map((e) => [e.id, e]));
    for (const [id, stop] of runners) {
      if (live.has(id)) continue;
      stop.abort();
      runners.delete(id);
    }
    for (const [id, entry] of live) {
      if (runners.has(id)) continue;
      try {
        serve(entry);
      } catch (error) {
        onError(error);
      }
    }
  }

  /**
   * A removed fragment's subscriptions go with it. Their waiting tasks are done for them: each
   * one asking for a reply gets an error, so no publisher waits for a command that is gone.
   */
  function removed(fragment: string): void {
    for (const sub of queue.listSubscriptions(P)) {
      if (sub.inbox || sub.owner !== TASKS_PRINCIPAL || fragmentOf(sub.name) !== fragment) continue;
      for (;;) {
        const waiting = queue.take(P, sub.name, own, { limit: 100 });
        if (!waiting.length) break;
        for (const task of waiting) {
          if (!task.reply_to) continue;
          try {
            queue.reply(P, task.id, TASKS_PRINCIPAL, {
              payload: { error: `${fragment} was removed: ${sub.name} serves no more tasks` },
            });
          } catch (error) {
            onError(error);
          }
        }
      }
      queue.unsubscribe(P, sub.name);
    }
  }

  const module: SystemTasksModule = {
    async publish({ subject, payload, wait }, context) {
      const sender = principalOf(context.caller);
      const task = { subject, ...(payload !== undefined ? { payload } : {}) };
      if (wait === false) return { task: queue.publish(P, task, sender).id };
      // Nobody would answer: a waited publish no subscription serves is refused at once.
      const served = queue
        .listSubscriptions(P)
        .some((s) => !s.inbox && subjectMatches(s.filter.subject, subject));
      if (!served) throw new Error(`no subscription serves '${subject}'`);
      const inbox = queue.createInbox(P, sender);
      const reader: QueueReader = { id: sender, destinations: [] };
      try {
        const published = queue.publish(
          P,
          {
            ...task,
            reply_to: inbox.name,
            ...(CORRELATION.test(context.callId) ? { correlation_id: context.callId } : {}),
          },
          sender,
        );
        const aborted = new Promise<void>((resolve) => {
          if (context.signal.aborted) resolve();
          else context.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        let seq = queue.changeSeq(P);
        for (;;) {
          if (context.signal.aborted) {
            // The caller gave up: the task is cancelled, a running handler stops.
            try {
              cancelTask(published.id, TASKS_PRINCIPAL, true);
            } catch (error) {
              onError(error);
            }
            throw context.signal.reason;
          }
          const [reply] = queue.take(P, inbox.name, reader);
          if (reply) return { task: published.id, ...(reply.payload as Record<string, unknown>) };
          seq = await Promise.race([queue.waitChange(P, seq, waitMs), aborted.then(() => seq)]);
        }
      } finally {
        queue.unsubscribe(P, inbox.name);
      }
    },
    cancel({ task }, context) {
      // The user cancels any task; a gated caller only its own.
      cancelTask(task, principalOf(context.caller), isUser(context.caller));
      return { cancelled: true };
    },
    job({ job, after, wait_ms }, context) {
      // The user reads any job (as its holder); a gated caller those of its own tasks.
      const reader = isUser(context.caller) ? TASKS_PRINCIPAL : principalOf(context.caller);
      return queue.waitJob(P, job, reader, {
        ...(after !== undefined ? { after } : {}),
        wait_ms: Math.min(Math.max(Number(wait_ms ?? 0), 0), MAX_WAIT_MS),
      });
    },
  };

  return {
    queue,
    module,
    activate() {
      const stopCommands = commands.observe(sync);
      let installed = new Set(slots.getSnapshot(installedFragmentsSlot).keys());
      const stopInstalled = slots.observe(installedFragmentsSlot, (entries) => {
        const now = new Set(entries.keys());
        for (const id of installed) {
          if (now.has(id)) continue;
          try {
            removed(id);
          } catch (error) {
            onError(error);
          }
        }
        installed = now;
      });
      return () => {
        stopCommands();
        stopInstalled();
        for (const stop of runners.values()) stop.abort();
        runners.clear();
      };
    },
  };
}
