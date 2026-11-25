// The call context: an id per call, the caller's cancellation and progress reaching the caller
// (statewalker/statewalker-root#407; ADR 2026-11-23-commands-tasks-and-jobs in statewalker-root).
import { describe, expect, it } from "vitest";
import type { CommandContext } from "../src/index.js";
import { command, fragment, operation, platform } from "./helpers.js";

const NOTES = "org.example.notes";
const ping = command(operation("ping"));

/** A platform whose one command `ping` hands its context to `handler`. */
async function withHandler(
  handler: (input: unknown, context: CommandContext) => unknown,
  options: Parameters<typeof platform>[2] = {},
) {
  return platform([fragment(NOTES, { commands: [ping] })], { [NOTES]: { ping: handler } }, options);
}

describe("the call context", () => {
  it("gives every call its own id", async () => {
    const ids: string[] = [];
    const { bus } = await withHandler((_input, context) => {
      ids.push(context.callId);
      return {};
    });
    await bus.call(`${NOTES}/ping`);
    await bus.call(`${NOTES}/ping`);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/\S+/);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("takes the id the user or system code supplies", async () => {
    let seen: string | undefined;
    const { bus } = await withHandler((_input, context) => {
      seen = context.callId;
      return {};
    });
    await bus.call(`${NOTES}/ping`, {}, { callId: "task-42" });
    expect(seen).toBe("task-42");
  });

  it("refuses an id from a caller that goes through the gate, before the gate runs", async () => {
    let gated = 0;
    let ran = false;
    const { bus } = await withHandler(
      () => {
        ran = true;
        return {};
      },
      {
        gate: () => {
          gated++;
        },
      },
    );
    const error = await bus
      .call(`${NOTES}/ping`, {}, { caller: { capability: "agent" }, callId: "someone-elses" })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ name: "CommandCallError", kind: "forbidden" });
    expect(gated).toBe(0);
    expect(ran).toBe(false);
  });

  it("aborts the handler's signal when the caller's aborts, and rejects the call `aborted`", async () => {
    const controller = new AbortController();
    let signal: AbortSignal | undefined;
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { bus } = await withHandler(
      (_input, context) =>
        new Promise((_resolve, reject) => {
          signal = context.signal;
          started();
          context.signal.addEventListener("abort", () => reject(context.signal.reason));
        }),
    );
    const call = bus.call(`${NOTES}/ping`, {}, { signal: controller.signal });
    await running;
    expect(signal?.aborted).toBe(false);
    const reason = new Error("stop");
    controller.abort(reason);
    const error = await call.catch((e: unknown) => e);
    expect(signal?.aborted).toBe(true);
    expect(error).toMatchObject({ name: "CommandCallError", kind: "aborted", cause: reason });
  });

  it("rejects an already-aborted call without running the handler", async () => {
    let ran = false;
    const { bus } = await withHandler(() => {
      ran = true;
      return {};
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      bus.call(`${NOTES}/ping`, {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ kind: "aborted" });
    expect(ran).toBe(false);
  });

  it("gives a call without a signal a signal that never aborts", async () => {
    let signal: AbortSignal | undefined;
    const { bus } = await withHandler((_input, context) => {
      signal = context.signal;
      return {};
    });
    await bus.call(`${NOTES}/ping`);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  it("delivers progress to the caller, in order, before the result", async () => {
    const events: unknown[] = [];
    const { bus } = await withHandler(async (_input, context) => {
      await context.progress({ step: 1 });
      await context.progress({ step: 2 });
      return { done: true };
    });
    const result = await bus.call(
      `${NOTES}/ping`,
      {},
      { onProgress: (entry) => void events.push(entry) },
    );
    events.push(result);
    expect(events).toEqual([{ step: 1 }, { step: 2 }, { done: true }]);
  });

  it("waits for an asynchronous onProgress, so progress can be written somewhere durable", async () => {
    const written: unknown[] = [];
    const { bus } = await withHandler(async (_input, context) => {
      await context.progress("a");
      expect(written).toEqual(["a"]);
      return {};
    });
    await bus.call(
      `${NOTES}/ping`,
      {},
      {
        onProgress: async (entry) => {
          await new Promise((r) => setTimeout(r, 5));
          written.push(entry);
        },
      },
    );
  });

  it("names the caller: the user, or the capability a gated caller presented", async () => {
    const callers: unknown[] = [];
    const { bus } = await withHandler(
      (_input, context) => {
        callers.push(context.caller);
        return {};
      },
      { gate: () => {} },
    );
    await bus.call(`${NOTES}/ping`);
    await bus.call(`${NOTES}/ping`, {}, { caller: { capability: "agent-1" } });
    expect(callers).toEqual([{ kind: "user" }, { capability: "agent-1" }]);
  });

  it("ignores progress when the caller does not listen", async () => {
    const { bus } = await withHandler(async (_input, context) => {
      await context.progress({ ignored: true });
      return { ok: true };
    });
    await expect(bus.call(`${NOTES}/ping`)).resolves.toEqual({ ok: true });
  });
});
