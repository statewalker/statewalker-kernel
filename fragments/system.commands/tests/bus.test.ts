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
