// Seam 1: the `task` exposure served headless (statewalker/statewalker-root#408): commands run from
// system.tasks' queue, published through `system.tasks/publish` on system.commands' bus.
import { activeFragmentsSlot, FragmentLifecycleError } from "@statewalker/kernel.core";
import { type CommandContext, harnessTools } from "@statewalker/system.commands";
import { describe, expect, it } from "vitest";
import { SYSTEM_TASKS_ID, subscriptionName, taskSubject } from "../src/index.js";
import { fragment, platform, taskCommand, until } from "./helpers.js";

const NOTES = "org.example.notes";
const EXPORT = `${NOTES}/export`;

interface PublishReply {
  task: string;
  job?: string;
  result?: unknown;
  error?: string;
  cancelled?: boolean;
}

describe("the task exposure", () => {
  it("runs a published task through the command, with the task id as callId, and replies", async () => {
    const seen: unknown[] = [];
    const { bus } = await platform([fragment(NOTES, [taskCommand("export")])], {
      [NOTES]: {
        export: (input: { n: number }, context: CommandContext) => {
          seen.push([input, context.callId]);
          return { doubled: input.n * 2 };
        },
      },
    });
    const reply = await bus.call<PublishReply>("system.tasks/publish", {
      subject: taskSubject(EXPORT),
      payload: { n: 21 },
    });
    expect(reply).toMatchObject({ result: { doubled: 42 } });
    expect(seen).toEqual([[{ n: 21 }, reply.task]]);
  });

  it("retries a throwing handler up to the attempts, then dead-letters it with an error reply", async () => {
    let calls = 0;
    const { bus, tasks } = await platform(
      [fragment(NOTES, [taskCommand("export")])],
      {
        [NOTES]: {
          export: () => {
            calls++;
            throw new Error("disk full");
          },
        },
      },
      { maxAttempts: 2 },
    );
    const reply = await bus.call<PublishReply>("system.tasks/publish", {
      subject: taskSubject(EXPORT),
    });
    expect(calls).toBe(2);
    expect(reply.error).toMatch(/export/);
    expect(reply.result).toBeUndefined();
    const dead = tasks.queue.deadLetters("local", subscriptionName(EXPORT));
    expect(dead).toMatchObject([{ attempts: 2 }]);
  });

  it("aborts the handler's signal when the publishing call is cancelled, without a retry", async () => {
    let calls = 0;
    let signal: AbortSignal | undefined;
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { bus, tasks, db } = await platform([fragment(NOTES, [taskCommand("export")])], {
      [NOTES]: {
        export: (_input: unknown, context: CommandContext) => {
          calls++;
          signal = context.signal;
          started();
          return new Promise((_resolve, reject) => {
            context.signal.addEventListener("abort", () => reject(context.signal.reason));
          });
        },
      },
    });
    const controller = new AbortController();
    const call = bus.call(
      "system.tasks/publish",
      { subject: taskSubject(EXPORT) },
      {
        signal: controller.signal,
      },
    );
    await running;
    controller.abort();
    await expect(call).rejects.toMatchObject({ kind: "aborted" });
    await until(() => signal?.aborted === true);
    const [job] = db.prepare("SELECT id FROM task_jobs").all() as { id: string }[];
    await until(
      () =>
        tasks.queue.job("local", String(job?.id), "system:tasks").entries.at(-1)?.outcome ===
        "cancelled",
    );
    expect(calls).toBe(1);
    expect(tasks.queue.deadLetters("local", subscriptionName(EXPORT))).toEqual([]);
  });

  it("cancels a task through system.tasks/cancel", async () => {
    const { bus, kernel } = await platform([fragment(NOTES, [taskCommand("export")])], {
      [NOTES]: { export: () => ({}) },
    });
    // With its fragment disabled the task waits; cancelled, it never runs.
    await kernel.disable(NOTES);
    const { task } = await bus.call<PublishReply>("system.tasks/publish", {
      subject: taskSubject(EXPORT),
      wait: false,
    });
    await expect(bus.call("system.tasks/cancel", { task })).resolves.toEqual({ cancelled: true });
    await expect(bus.call("system.tasks/cancel", { task })).rejects.toMatchObject({
      kind: "handler-error",
    });
  });

  it("keeps the handler's progress in the job log, resumable after a stamp", async () => {
    const { bus } = await platform([fragment(NOTES, [taskCommand("export")])], {
      [NOTES]: {
        export: async (_input: unknown, context: CommandContext) => {
          await context.progress({ step: 1 });
          await context.progress({ step: 2 });
          return { ok: true };
        },
      },
    });
    const reply = await bus.call<PublishReply>("system.tasks/publish", {
      subject: taskSubject(EXPORT),
    });
    type Log = { entries: { at: number; progress: unknown; outcome?: string }[] };
    const log = await bus.call<Log>("system.tasks/job", { job: reply.job });
    expect(log.entries.map((e) => e.outcome ?? e.progress)).toEqual([
      { step: 1 },
      { step: 2 },
      "done",
    ]);
    const after = await bus.call<Log>("system.tasks/job", {
      job: reply.job,
      after: log.entries[0]?.at,
    });
    expect(after.entries.map((e) => e.outcome ?? e.progress)).toEqual([{ step: 2 }, "done"]);
  });
});

describe("the subscriptions of task-exposed commands", () => {
  it("follow the fragment: kept while it is disabled, its tasks served when it returns, removed with it", async () => {
    const ran: unknown[] = [];
    const { bus, kernel, tasks } = await platform([fragment(NOTES, [taskCommand("export")])], {
      [NOTES]: {
        export: (input: unknown) => {
          ran.push(input);
          return {};
        },
      },
    });
    const name = subscriptionName(EXPORT);
    expect(tasks.queue.getSubscription("local", name).filter.subject).toBe(taskSubject(EXPORT));
    // A command lives while its fragment is resolved: disabled, it leaves the bus.
    await kernel.disable(NOTES);
    await bus.call("system.tasks/publish", {
      subject: taskSubject(EXPORT),
      payload: { n: 1 },
      wait: false,
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(ran).toEqual([]);
    expect(tasks.queue.getSubscription("local", name).counts).toMatchObject({ waiting: 1 });
    await kernel.enable(NOTES);
    await kernel.activate("client", NOTES);
    await until(() => ran.length === 1);
    expect(ran).toEqual([{ n: 1 }]);
    await kernel.remove(NOTES);
    expect(tasks.queue.listSubscriptions("local").map((s) => s.name)).not.toContain(name);
  });
});

describe("the system.tasks fragment", () => {
  it("is a core fragment that cannot be disabled", async () => {
    const { kernel } = await platform([]);
    expect([...kernel.slots.getSnapshot(activeFragmentsSlot("client")).keys()]).toContain(
      SYSTEM_TASKS_ID,
    );
    await expect(kernel.disable(SYSTEM_TASKS_ID)).rejects.toBeInstanceOf(FragmentLifecycleError);
  });

  it("offers system.tasks/publish to agents", async () => {
    const { bus } = await platform([]);
    const tools = harnessTools(bus.list()).map((t) => t["x-dev.cellb.harness"].id);
    expect(tools).toContain("system.tasks/publish");
  });

  it("runs an agent's task as that agent: the handler sees its capability", async () => {
    const callers: unknown[] = [];
    const { bus } = await platform(
      [fragment(NOTES, [taskCommand("export")])],
      {
        [NOTES]: {
          export: (_input: unknown, context: CommandContext) => {
            callers.push(context.caller);
            return {};
          },
        },
      },
      { gate: () => {} },
    );
    await bus.call(
      "system.tasks/publish",
      { subject: taskSubject(EXPORT) },
      { caller: { capability: "agent-1" } },
    );
    expect(callers).toEqual([{ capability: "agent-1" }]);
  });

  it("refuses a waited publish no subscription serves, at once", async () => {
    const { bus } = await platform([]);
    await expect(
      bus.call("system.tasks/publish", { subject: "fragments.nobody.here" }),
    ).rejects.toMatchObject({ kind: "handler-error" });
  });

  it("answers the waiting publishers of a removed fragment's tasks with an error", async () => {
    const { bus, kernel } = await platform([fragment(NOTES, [taskCommand("export")])], {
      [NOTES]: { export: () => ({}) },
    });
    await kernel.disable(NOTES);
    const waiting = bus.call<PublishReply>("system.tasks/publish", {
      subject: taskSubject(EXPORT),
    });
    await new Promise((r) => setTimeout(r, 50));
    await kernel.remove(NOTES);
    expect((await waiting).error).toMatch(/removed/);
  });

  it("runs a task an agent published only if the gate lets the agent run that command", async () => {
    const decided: unknown[] = [];
    let ran = 0;
    const { bus } = await platform(
      [fragment(NOTES, [taskCommand("export")])],
      { [NOTES]: { export: () => ({ ran: ++ran }) } },
      {
        // A refusal is final: the gate is not asked again for the attempts left.
        maxAttempts: 3,
        gate: ({ command, caller }) => {
          decided.push([command.id, caller]);
          if (command.id === EXPORT) throw new Error("no grant for export");
        },
      },
    );
    const reply = await bus.call<PublishReply>(
      "system.tasks/publish",
      { subject: taskSubject(EXPORT) },
      { caller: { capability: "agent-1" } },
    );
    expect(ran).toBe(0);
    expect(reply.error).toMatch(/no grant for export/);
    expect(decided).toEqual([
      ["system.tasks/publish", { capability: "agent-1" }],
      [EXPORT, { capability: "agent-1" }],
    ]);
  });
});
