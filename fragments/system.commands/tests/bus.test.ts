import { describe, expect, it } from "vitest";
import { command, fragment, operation, platform } from "./helpers.js";

const NOTES = "org.example.notes";

const sum = operation(
  "add",
  {
    type: "object",
    required: ["a", "b"],
    properties: { a: { type: "number" }, b: { type: "number" } },
  },
  { type: "object", required: ["sum"], properties: { sum: { type: "number" } } },
);

describe("the command bus", () => {
  it("calls a fragment's command, by `<fragment-id>/<command-id>`, through its handler", async () => {
    const { bus } = await platform([fragment(NOTES, { commands: [command(sum)] })], {
      [NOTES]: { add: (input: { a: number; b: number }) => ({ sum: input.a + input.b }) },
    });
    await expect(bus.call(`${NOTES}/add`, { a: 2, b: 3 })).resolves.toEqual({ sum: 5 });
  });
});

describe("handlers", () => {
  it("get the validated input and the call's context", async () => {
    const seen: unknown[] = [];
    const { bus } = await platform([fragment(NOTES, { commands: [command(sum)] })], {
      [NOTES]: {
        add: (input: { a: number; b: number }, context: unknown) => {
          seen.push(input, context);
          return { sum: 0 };
        },
      },
    });
    await bus.call(`${NOTES}/add`, { a: 1, b: 2 });
    expect(seen).toEqual([{ a: 1, b: 2 }, { command: `${NOTES}/add` }]);
  });

  it("take a missing input as an empty object", async () => {
    const { bus } = await platform([fragment(NOTES, { commands: [command(operation("ping"))] })], {
      [NOTES]: { ping: (input: unknown) => ({ input }) },
    });
    await expect(bus.call(`${NOTES}/ping`)).resolves.toEqual({ input: {} });
  });
});

describe("callers other than the user", () => {
  const ping = command(operation("ping"));
  const pong = { [NOTES]: { ping: () => ({ pong: true }) } };

  it("are refused when no gate is wired, and the handler does not run", async () => {
    let ran = false;
    const { bus } = await platform([fragment(NOTES, { commands: [ping] })], {
      [NOTES]: {
        ping: () => {
          ran = true;
          return {};
        },
      },
    });
    await expect(
      bus.call(`${NOTES}/ping`, {}, { caller: { capability: "anything" } }),
    ).rejects.toMatchObject({ name: "CommandCallError", kind: "forbidden" });
    expect(ran).toBe(false);
  });

  it("are decided by the gate, which sees the command, the caller and the input", async () => {
    const seen: unknown[] = [];
    const { bus } = await platform([fragment(NOTES, { commands: [ping] })], pong, {
      gate: ({ command, caller, input }) => {
        seen.push([command.id, caller, input]);
      },
    });
    await expect(
      bus.call(`${NOTES}/ping`, { a: 1 }, { caller: { capability: "t" } }),
    ).resolves.toEqual({ pong: true });
    expect(seen).toEqual([[`${NOTES}/ping`, { capability: "t" }, { a: 1 }]]);
  });

  it("are refused with the gate's reason when the gate throws", async () => {
    const { bus } = await platform([fragment(NOTES, { commands: [ping] })], pong, {
      gate: () => {
        throw new Error("no grant");
      },
    });
    const error = await bus
      .call(`${NOTES}/ping`, {}, { caller: { capability: "t" } })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "forbidden", message: "no grant" });
  });
});

describe("the user's own calls", () => {
  it("never reach the gate", async () => {
    let gated = 0;
    const { bus } = await platform(
      [fragment(NOTES, { commands: [command(operation("ping"))] })],
      { [NOTES]: { ping: () => ({}) } },
      {
        gate: () => {
          gated++;
          throw new Error("refused");
        },
      },
    );
    await expect(bus.call(`${NOTES}/ping`)).resolves.toEqual({});
    await expect(bus.call(`${NOTES}/ping`, {}, {})).resolves.toEqual({});
    await expect(bus.call(`${NOTES}/ping`, {}, { caller: { kind: "user" } })).resolves.toEqual({});
    expect(gated).toBe(0);
  });
});

describe("a gated call's input", () => {
  it("is the one the gate saw, though the caller changes its object while the gate waits", async () => {
    let release = () => {};
    const seen: unknown[] = [];
    const { bus } = await platform(
      [fragment(NOTES, { commands: [command(operation("save"))] })],
      {
        [NOTES]: {
          save: (input: unknown) => {
            seen.push(input);
            return {};
          },
        },
      },
      {
        gate: ({ input }) => {
          seen.push(structuredClone(input));
          return new Promise<void>((resolve) => {
            release = resolve;
          });
        },
      },
    );
    const input: Record<string, unknown> = { path: "/notes/a" };
    const call = bus.call(`${NOTES}/save`, input, { caller: { capability: "t" } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    input.path = "/etc/passwd";
    release();
    await call;
    expect(seen).toEqual([{ path: "/notes/a" }, { path: "/notes/a" }]);
  });
});
