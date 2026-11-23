import { describe, expect, it, vi } from "vitest";
import { CommandCallError, CommandFailure } from "../src/index.js";
import { command, fragment, operation, platform } from "./helpers.js";

const NOTES = "org.example.notes";

const notFound = {
  404: {
    description: "No such note",
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["code"],
          properties: {
            code: { const: "not-found" },
            message: { type: "string" },
            data: { type: "object", properties: { id: { type: "string" } } },
          },
        },
      },
    },
  },
};

const getNote = operation(
  "get-note",
  { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  { type: "object", required: ["text"], properties: { text: { type: "string" } } },
  { responses: notFound },
);

/** The rejection of `promise`, which must be a CommandCallError. */
async function failure(promise: Promise<unknown>): Promise<CommandCallError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CommandCallError);
  return error as CommandCallError;
}

describe("typed errors of a call", () => {
  it("refuse input that does not match the input schema, before the handler runs", async () => {
    const handler = vi.fn(() => ({ text: "x" }));
    const { bus } = await platform([fragment(NOTES, { commands: [command(getNote)] })], {
      [NOTES]: { "get-note": handler },
    });
    const error = await failure(bus.call(`${NOTES}/get-note`, { id: 42 }));
    expect(error.kind).toBe("invalid-input");
    expect(error.command).toBe(`${NOTES}/get-note`);
    expect(error.issues.join("\n")).toContain("/id");
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuse an unknown command", async () => {
    const { bus } = await platform([fragment(NOTES, { commands: [command(getNote)] })]);
    const error = await failure(bus.call(`${NOTES}/nothing`, {}));
    expect(error.kind).toBe("unknown-command");
    expect(error.command).toBe(`${NOTES}/nothing`);
  });

  it("carry a declared error the handler raises, with its code, status and data", async () => {
    const { bus } = await platform([fragment(NOTES, { commands: [command(getNote)] })], {
      [NOTES]: {
        "get-note": (input: { id: string }) => {
          throw new CommandFailure("not-found", `no note ${input.id}`, { id: input.id });
        },
      },
    });
    const error = await failure(bus.call(`${NOTES}/get-note`, { id: "n1" }));
    expect(error.kind).toBe("declared-error");
    expect(error.code).toBe("not-found");
    expect(error.status).toBe("404");
    expect(error.data).toEqual({ id: "n1" });
    expect(error.message).toBe("no note n1");
  });

  it("report an undeclared error as a handler error, with the thrown value as cause", async () => {
    const thrown = new CommandFailure("conflict", "not declared");
    const boom = new Error("boom");
    const { bus } = await platform(
      [fragment(NOTES, { commands: [command(getNote), command(operation("crash"))] })],
      {
        [NOTES]: {
          "get-note": () => {
            throw thrown;
          },
          crash: () => Promise.reject(boom),
        },
      },
    );
    const undeclared = await failure(bus.call(`${NOTES}/get-note`, { id: "n1" }));
    expect(undeclared.kind).toBe("handler-error");
    expect(undeclared.cause).toBe(thrown);
    const crashed = await failure(bus.call(`${NOTES}/crash`, {}));
    expect(crashed.kind).toBe("handler-error");
    expect(crashed.cause).toBe(boom);
  });

  it("refuse a result that does not match the output schema", async () => {
    const { bus } = await platform([fragment(NOTES, { commands: [command(getNote)] })], {
      [NOTES]: { "get-note": () => ({ text: 7 }) },
    });
    const error = await failure(bus.call(`${NOTES}/get-note`, { id: "n1" }));
    expect(error.kind).toBe("invalid-output");
    expect(error.issues.join("\n")).toContain("/text");
  });

  it("refuse a call to a command declared without a handler", async () => {
    const { bus } = await platform([
      fragment(NOTES, { commands: [{ data: { operation: operation("idle") } }] }),
    ]);
    expect(bus.get(`${NOTES}/idle`)?.handled).toBe(false);
    const error = await failure(bus.call(`${NOTES}/idle`, {}));
    expect(error.kind).toBe("no-handler");
  });
});
