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
import { localQueueStore, type QueueReaderData, type QueueStore, type TaskJob } from "./store.js";

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
  /**
   * Where the queue lives: `store`, the fragment DO's (`remoteQueueStore`, through its server
   * half), or a queue over `sql` in this process (SQLite in memory headless). One of them.
   */
  readonly store?: QueueStore;
  readonly sql?: SqlLike;
  /**
   * The queue on a fragment's home, when the route table places it on another host
   * (statewalker-root#410); undefined: this host's (`store`). Asked at each publish and runner
   * start: a publish under `fragments.<id>.` goes to `<id>`'s home, and the runners of `<id>`'s
   * task-exposed commands serve its subscriptions there. `rehome()` follows a route's change.
   */
  readonly storeOf?: (fragment: string) => QueueStore | undefined;
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
  readonly cancel: (
    input: { task: string },
    context: CommandContext,
  ) => Promise<{ cancelled: true }>;
  readonly job: (
    input: { job: string; after?: number; wait_ms?: number },
    context: CommandContext,
  ) => Promise<unknown>;
  readonly jobs: (input: { task: string }, context: CommandContext) => Promise<{ jobs: TaskJob[] }>;
  readonly [name: string]: unknown;
}

/** The system.tasks fragment's code: its queue, its module, and its client activator body. */
export interface SystemTasks {
  /** The queue, when it is in this process (`sql`); none when it is the fragment DO's. */
  readonly queue: TaskQueue | undefined;
  readonly store: QueueStore;
  /** The fragment's module: what its own extensions' references (`./index.js`) resolve to. */
  readonly module: SystemTasksModule;
  /** Activate the client aspect: serve the task-exposed commands. Returns the cleanup. */
  activate(context: ActivationContext): AspectCleanup;
  /**
   * The route table changed (a Move): each runner whose fragment's home changed is started again
   * at the new home. Tasks left in the old home's queue wait there.
   */
  rehome(): void;
}

/** The fragment a subject under `fragments.<id>.<command>` names; undefined for any other. */
export function subjectFragment(subject: string): string | undefined {
  if (!subject.startsWith("fragments.")) return undefined;
  const rest = subject.slice("fragments.".length);
  const dot = rest.lastIndexOf(".");
  const fragment = dot > 0 ? rest.slice(0, dot) : "";
  // A wildcard names no one fragment: its fan-out stays on this host.
  if (!fragment || /[*>]/.test(fragment) || /[*>]/.test(rest.slice(dot + 1))) return undefined;
  return fragment;
}

export function createSystemTasks(options: SystemTasksOptions): SystemTasks {
  const { commands, callAs, slots, gate } = options;
  const onError = options.onError ?? (() => {});
  const waitMs = options.waitMs ?? 30_000;
  const queue = options.sql ? new TaskQueue(options.sql, options.queue ?? {}) : undefined;
  const chosen = options.store ?? (queue ? localQueueStore(queue) : undefined);
  if (!chosen) throw new Error("system.tasks needs its queue: a store, or sql");
  const store: QueueStore = chosen;
  const P = TASKS_PROJECT;
  const own: QueueReaderData = { id: TASKS_PRINCIPAL, destinations: [], admin: true };
  /** The queue on `fragment`'s home: another host's, or this one's. */
  const homeOf = (fragment: string | undefined): QueueStore =>
    (fragment !== undefined ? options.storeOf?.(fragment) : undefined) ?? store;
  // The queue each task this host published lives in, when it is not this host's: its cancel and
  // job reads go there.
  const taskHomes = new Map<string, QueueStore>();
  const storeOfTask = (task: string): QueueStore => taskHomes.get(task) ?? store;
  const jobHomes = new Map<string, QueueStore>();
  const runners = new Map<string, { stop: AbortController; home: QueueStore }>();
  let lastEntries: readonly CommandEntry[] = [];
  // The running tasks of this host: a cancel makes each one's runner renew at once, so the
  // queue's "cancelled" reaches its handler without waiting for the next renew.
  const running = new Map<string, () => void>();

  async function cancelTask(task: string, by: string, admin: boolean): Promise<void> {
    await storeOfTask(task).cancel(P, task, by, { admin });
    running.get(task)?.();
  }

  /** Ends a task for good with an error: its reply (when it asks for one), then a cancel. */
  async function refuse(
    home: QueueStore,
    task: string,
    replyTo: string | undefined,
    job: string,
    error: unknown,
  ): Promise<void> {
    const message = String((error as Error)?.message ?? error);
    try {
      if (replyTo) await home.reply(P, task, TASKS_PRINCIPAL, { payload: { job, error: message } });
      await home.cancel(P, task, TASKS_PRINCIPAL, { admin: true });
    } catch (e) {
      onError(e);
    }
  }

  function processorOf(id: string, home: QueueStore): Processor {
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
            await refuse(home, lease.task.id, lease.task.reply_to, lease.id, refusal);
            throw refusal;
          }
        }
        running.set(lease.task.id, () => void context.progress(null).catch(() => {}));
        // The task's job index: a viewer finds this attempt's log, and its reply, by the task.
        await home.recordJob(P, lease.task.id, lease.id).catch(onError);
        try {
          // As its publisher: the handler sees the caller the gate let through.
          const result = await callAs(caller, id, payload, {
            callId: lease.task.id,
            signal: context.signal,
            onProgress: (entry) => context.progress(entry),
          });
          await home.recordReply(P, lease.id, { job: lease.id, result }).catch(onError);
          return result;
        } catch (error) {
          // An error the queue retries is not the task's answer yet: `retry` says another attempt
          // follows (a viewer waits for its job), as the runner replies only after the last one.
          // Cancelled only when the queue says so (ECANCELED): a lost lease or a stopped runner
          // aborts the signal too, and the queue then runs the task again.
          const cancelled =
            (context.signal.reason as { code?: unknown } | undefined)?.code === "ECANCELED";
          const lost = context.signal.aborted && !cancelled;
          const reply = cancelled
            ? { job: lease.id, cancelled: true }
            : lost
              ? { job: lease.id, error: "the attempt stopped", retry: true }
              : {
                  job: lease.id,
                  error: String((error as Error)?.message ?? error),
                  ...(lease.attempt < lease.max_attempts ? { retry: true } : {}),
                };
          await home.recordReply(P, lease.id, reply).catch(onError);
          throw error;
        } finally {
          running.delete(lease.task.id);
        }
      },
    };
  }

  async function serve(
    entry: CommandEntry,
    stop: AbortController,
    home: QueueStore,
  ): Promise<void> {
    const name = subscriptionName(entry.id);
    if (!(await home.listSubscriptions(P)).some((s) => s.name === name))
      await home.subscribe(
        P,
        {
          name,
          filter: { subject: taskSubject(entry.id) },
          ...(options.leaseMs !== undefined ? { lease_ms: options.leaseMs } : {}),
          ...(options.maxAttempts !== undefined ? { max_attempts: options.maxAttempts } : {}),
        },
        TASKS_PRINCIPAL,
      );
    if (stop.signal.aborted) return;
    await serveSubscription(home.api(own), {
      project: P,
      subscription: name,
      processor: processorOf(entry.id, home),
      signal: stop.signal,
      waitMs,
      onError,
    });
  }

  /** Serve exactly the live task-exposed commands; a runner stops, its subscription stays. */
  function sync(entries: readonly CommandEntry[]): void {
    lastEntries = entries;
    const live = new Map(entries.filter((e) => e.exposures.task).map((e) => [e.id, e]));
    for (const [id, runner] of runners) {
      // Gone, or its fragment's home changed: stopped (and started again at the new home).
      if (live.has(id) && runner.home === homeOf(fragmentOf(subscriptionName(id)))) continue;
      runner.stop.abort();
      runners.delete(id);
    }
    for (const [id, entry] of live) {
      if (runners.has(id)) continue;
      const stop = new AbortController();
      const home = homeOf(fragmentOf(subscriptionName(id)));
      const runner = { stop, home };
      runners.set(id, runner);
      serve(entry, stop, home).catch((error: unknown) => {
        // A runner that could not start (its store unreachable) is started again by the next
        // change of the commands, not left registered as running.
        if (runners.get(id) === runner) runners.delete(id);
        onError(error);
      });
    }
  }

  /**
   * A removed fragment's subscriptions go with it. Their waiting tasks are done for them: each
   * one asking for a reply gets an error, so no publisher waits for a command that is gone.
   */
  async function removed(fragment: string): Promise<void> {
    // Here, and at its home when that is another host.
    for (const queue of new Set([store, homeOf(fragment)])) await removedFrom(queue, fragment);
  }

  async function removedFrom(store: QueueStore, fragment: string): Promise<void> {
    for (const sub of await store.listSubscriptions(P)) {
      if (sub.inbox || sub.owner !== TASKS_PRINCIPAL || fragmentOf(sub.name) !== fragment) continue;
      for (;;) {
        const waiting = await store.take(P, sub.name, own, { limit: 100 });
        if (!waiting.length) break;
        for (const task of waiting) {
          if (!task.reply_to) continue;
          try {
            await store.reply(P, task.id, TASKS_PRINCIPAL, {
              payload: { error: `${fragment} was removed: ${sub.name} serves no more tasks` },
            });
          } catch (error) {
            onError(error);
          }
        }
      }
      await store.unsubscribe(P, sub.name);
    }
  }

  const module: SystemTasksModule = {
    async publish({ subject, payload, wait }, context) {
      const sender = principalOf(context.caller);
      const task = { subject, ...(payload !== undefined ? { payload } : {}) };
      // To the queue on the fragment's home (statewalker-root#410): never queued here instead.
      const home = homeOf(subjectFragment(subject));
      const remember = (id: string) => {
        if (home !== store) taskHomes.set(id, home);
        return id;
      };
      if (wait === false) return { task: remember((await home.publish(P, task, sender)).id) };
      // Nobody would answer: a waited publish no subscription serves is refused at once.
      const served = (await home.listSubscriptions(P)).some(
        (s) => !s.inbox && subjectMatches(s.filter.subject, subject),
      );
      if (!served) throw new Error(`no subscription serves '${subject}'`);
      // The reply's inbox is on the queue the task is in: its runner replies there, and this
      // publisher, on its own host, takes the reply from it.
      const inbox = await home.createInbox(P, sender);
      const reader: QueueReaderData = { id: sender, destinations: [] };
      try {
        const published = await home.publish(
          P,
          {
            ...task,
            reply_to: inbox.name,
            ...(CORRELATION.test(context.callId) ? { correlation_id: context.callId } : {}),
          },
          sender,
        );
        remember(published.id);
        const aborted = new Promise<void>((resolve) => {
          if (context.signal.aborted) resolve();
          else context.signal.addEventListener("abort", () => resolve(), { once: true });
        });
        let seq = await home.changeSeq(P);
        for (;;) {
          if (context.signal.aborted) {
            // The caller gave up: the task is cancelled, a running handler stops.
            try {
              await cancelTask(published.id, TASKS_PRINCIPAL, true);
            } catch (error) {
              onError(error);
            }
            throw context.signal.reason;
          }
          const [reply] = await home.take(P, inbox.name, reader);
          if (reply) {
            const answer = reply.payload as Record<string, unknown>;
            if (home !== store && typeof answer?.job === "string") jobHomes.set(answer.job, home);
            return { task: published.id, ...answer };
          }
          seq = await Promise.race([home.waitChange(P, seq, waitMs), aborted.then(() => seq)]);
        }
      } finally {
        await home.unsubscribe(P, inbox.name).catch(onError);
      }
    },
    async cancel({ task }, context) {
      // The user cancels any task; a gated caller only its own.
      await cancelTask(task, principalOf(context.caller), isUser(context.caller));
      return { cancelled: true };
    },
    async jobs({ task }, context) {
      const home = storeOfTask(task);
      const jobs = await home.jobsOf(P, task);
      if (home !== store) for (const j of jobs) jobHomes.set(j.job, home);
      if (isUser(context.caller)) return { jobs };
      // A gated caller reads only the jobs of its own tasks: those its job reads would allow.
      const reader = principalOf(context.caller);
      const own: TaskJob[] = [];
      for (const job of jobs) {
        try {
          await home.waitJob(P, job.job, reader, { wait_ms: 0 });
          own.push(job);
        } catch {
          // not its task's
        }
      }
      return { jobs: own };
    },
    job({ job, after, wait_ms }, context) {
      // The user reads any job (as its holder); a gated caller those of its own tasks.
      const reader = isUser(context.caller) ? TASKS_PRINCIPAL : principalOf(context.caller);
      return (jobHomes.get(job) ?? store).waitJob(P, job, reader, {
        ...(after !== undefined ? { after } : {}),
        wait_ms: Math.min(Math.max(Number(wait_ms ?? 0), 0), MAX_WAIT_MS),
      });
    },
  };

  return {
    queue,
    store,
    module,
    activate() {
      const stopCommands = commands.observe(sync);
      let installed = new Set(slots.getSnapshot(installedFragmentsSlot).keys());
      const stopInstalled = slots.observe(installedFragmentsSlot, (entries) => {
        const now = new Set(entries.keys());
        for (const id of installed) {
          if (now.has(id)) continue;
          removed(id).catch(onError);
        }
        installed = now;
      });
      return () => {
        stopCommands();
        stopInstalled();
        for (const { stop } of runners.values()) stop.abort();
        runners.clear();
      };
    },
    rehome() {
      sync(lastEntries);
    },
  };
}
