import { extensionRefusalsSlot } from "@statewalker/kernel.core";
import {
  CommandCallError,
  CommandFailure,
  harnessTools,
  labelsOf,
} from "@statewalker/system.commands";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFragment, generateFragmentFiles } from "../src/index.js";
import { platform } from "./helpers.js";

const NOTES = "org.example.notes";

const notes = defineFragment({
  id: NOTES,
  version: "1.0.0",
  engines: { platform: "^1.0.0" },
  commands: {
    "get-note": {
      summary: "Read a note",
      input: z.object({ id: z.string().min(1) }),
      output: z.object({ text: z.string() }),
      errors: {
        "not-found": {
          status: 404,
          description: "No such note",
          data: z.object({ id: z.string() }),
        },
      },
      exposures: { agent: { action: "read" } },
      labels: { fr: { title: "Lire une note" } },
      handler: { module: "./commands.js", export: "getNote" },
    },
    ping: { handler: { module: "./commands.js", export: "ping" } },
  },
});

const handlers = {
  [NOTES]: {
    getNote: ({ id }: { id: string }) => {
      if (id !== "n1") throw new CommandFailure("not-found", `no note ${id}`, { id });
      return { text: "hello" };
    },
    ping: (input: unknown) => ({ input }),
  },
};

describe("commands", () => {
  it("are generated as extensions of `commands` that the real system.commands calls", async () => {
    const files = generateFragmentFiles(notes);
    const { bus, kernel } = await platform([files], handlers);
    expect([...kernel.slots.getSnapshot(extensionRefusalsSlot("client")).values()]).toEqual([]);
    expect(bus.list().map((c) => c.id)).toEqual([`${NOTES}/get-note`, `${NOTES}/ping`]);
    await expect(bus.call(`${NOTES}/get-note`, { id: "n1" })).resolves.toEqual({ text: "hello" });
    await expect(bus.call(`${NOTES}/ping`)).resolves.toEqual({ input: {} });
  });

  it("validate input with the schema derived from Zod, before the handler runs", async () => {
    const { bus } = await platform([generateFragmentFiles(notes)], handlers);
    const empty = await bus.call(`${NOTES}/get-note`, { id: "" }).catch((e: unknown) => e);
    expect(empty).toBeInstanceOf(CommandCallError);
    expect((empty as CommandCallError).kind).toBe("invalid-input");
    await expect(bus.call(`${NOTES}/ping`, { extra: 1 })).rejects.toMatchObject({
      kind: "invalid-input",
    });
  });

  it("declare their errors as responses the bus reports by code and status", async () => {
    const { bus } = await platform([generateFragmentFiles(notes)], handlers);
    const error = await bus.call(`${NOTES}/get-note`, { id: "n2" }).catch((e) => e);
    expect(error).toMatchObject({
      kind: "declared-error",
      code: "not-found",
      status: "404",
      data: { id: "n2" },
    });
  });

  it("keep exposures and labels, so the agent projection sees them", async () => {
    const { bus } = await platform([generateFragmentFiles(notes)], handlers);
    const tools = harnessTools(bus.list(), { locale: "fr" });
    expect(tools.map((t) => t.info.title)).toEqual([`${NOTES}/get-note`]);
    const [getNote] = bus.list();
    expect(getNote && labelsOf(getNote, "fr").title).toBe("Lire une note");
  });

  it("refuse an input schema that is not an object", () => {
    expect(() =>
      generateFragmentFiles(
        defineFragment({
          id: NOTES,
          version: "1.0.0",
          engines: { platform: "^1.0.0" },
          commands: { bad: { input: z.string() } },
        }),
      ),
    ).toThrow(/bad.*input.*object/);
  });

  it("report each of several errors sharing a status by its own code", async () => {
    const config = defineFragment({
      id: NOTES,
      version: "1.0.0",
      engines: { platform: "^1.0.0" },
      commands: {
        save: {
          input: z.object({ kind: z.string() }),
          errors: {
            locked: { status: 409, data: z.object({ by: z.string() }) },
            stale: { status: 409 },
          },
          handler: { module: "./commands.js", export: "save" },
        },
      },
    });
    const { bus } = await platform([generateFragmentFiles(config)], {
      [NOTES]: {
        save: ({ kind }: { kind: string }) => {
          if (kind === "locked") throw new CommandFailure("locked", "locked", { by: "ann" });
          throw new CommandFailure("stale");
        },
      },
    });
    await expect(bus.call(`${NOTES}/save`, { kind: "locked" })).rejects.toMatchObject({
      kind: "declared-error",
      code: "locked",
      status: "409",
      data: { by: "ann" },
    });
    await expect(bus.call(`${NOTES}/save`, { kind: "stale" })).rejects.toMatchObject({
      kind: "declared-error",
      code: "stale",
      status: "409",
    });
  });
});
