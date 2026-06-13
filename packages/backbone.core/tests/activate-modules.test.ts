import { describe, expect, it, vi } from "vitest";
import { activateModules } from "../src/activate-modules.js";

describe("activateModules", () => {
  it("activates each root in order and calls default(ctx)", async () => {
    const ctx = { seen: [] as string[] };
    const roots = ["a", "b", "c"];
    const modules: Record<string, { default: (ctx: Record<string, unknown>) => void }> = {
      a: {
        default: (c) => {
          (c.seen as string[]).push("a");
        },
      },
      b: {
        default: (c) => {
          (c.seen as string[]).push("b");
        },
      },
      c: {
        default: (c) => {
          (c.seen as string[]).push("c");
        },
      },
    };
    await activateModules(roots, async (name) => modules[name], ctx);
    expect(ctx.seen).toEqual(["a", "b", "c"]);
  });

  it("invokes teardowns in reverse order", async () => {
    const order: string[] = [];
    const modules: Record<string, { default: () => () => void }> = {
      a: { default: () => () => order.push("teardown-a") },
      b: { default: () => () => order.push("teardown-b") },
      c: { default: () => () => order.push("teardown-c") },
    };
    const cleanup = await activateModules(["a", "b", "c"], async (n) => modules[n], {});
    await cleanup();
    expect(order).toEqual(["teardown-c", "teardown-b", "teardown-a"]);
  });

  it("awaits async teardowns", async () => {
    const order: string[] = [];
    const modules: Record<string, { default: () => () => Promise<void> }> = {
      a: {
        default: () => async () => {
          await new Promise((r) => setTimeout(r, 5));
          order.push("teardown-a");
        },
      },
    };
    const cleanup = await activateModules(["a"], async (n) => modules[n], {});
    await cleanup();
    expect(order).toEqual(["teardown-a"]);
  });

  it("continues after a module throws during init", async () => {
    const seen: string[] = [];
    const onError = vi.fn();
    const modules: Record<string, { default: () => void }> = {
      a: {
        default: () => {
          seen.push("a");
        },
      },
      b: {
        default: () => {
          throw new Error("boom");
        },
      },
      c: {
        default: () => {
          seen.push("c");
        },
      },
    };
    await activateModules(["a", "b", "c"], async (n) => modules[n], {}, onError);
    expect(seen).toEqual(["a", "c"]);
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBe("b");
  });

  it("continues when loadModule throws", async () => {
    const onError = vi.fn();
    const seen: string[] = [];
    const modules: Record<string, { default: () => void } | undefined> = {
      a: { default: () => seen.push("a") },
      c: { default: () => seen.push("c") },
    };
    await activateModules(
      ["a", "b", "c"],
      async (n) => {
        if (n === "b") throw new Error("load failed");
        return modules[n];
      },
      {},
      onError,
    );
    expect(seen).toEqual(["a", "c"]);
    expect(onError).toHaveBeenCalledOnce();
  });

  it("ignores modules whose default export is not a function", async () => {
    const modules: Record<string, Record<string, unknown>> = {
      a: { default: 42 },
      b: { other: () => {} },
    };
    const cleanup = await activateModules(["a", "b"], async (n) => modules[n], {});
    await cleanup();
  });
});
