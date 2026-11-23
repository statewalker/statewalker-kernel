import { describe, expect, it } from "vitest";
import { CommandCallError } from "../src/index.js";
import { command, fragment, operation, platform } from "./helpers.js";

const NOTES = "org.example.notes";
const TODO = "org.example.todo";

describe("commands follow their fragment", () => {
  it("disabling a fragment removes its commands from the bus; enabling brings them back", async () => {
    const { kernel, bus } = await platform(
      [
        fragment(NOTES, { commands: [command(operation("list"))] }),
        fragment(TODO, { commands: [command(operation("list"))] }),
      ],
      { [NOTES]: { list: () => ({ from: "notes" }) }, [TODO]: { list: () => ({ from: "todo" }) } },
    );
    expect(bus.list().map((c) => c.id)).toEqual([`${NOTES}/list`, `${TODO}/list`]);

    await kernel.disable(NOTES);
    expect(bus.list().map((c) => c.id)).toEqual([`${TODO}/list`]);
    await expect(bus.call(`${NOTES}/list`)).rejects.toMatchObject({ kind: "unknown-command" });
    await expect(bus.call(`${TODO}/list`)).resolves.toEqual({ from: "todo" });

    await kernel.enable(NOTES);
    await expect(bus.call(`${NOTES}/list`)).resolves.toEqual({ from: "notes" });
  });

  it("a call running when its fragment leaves fails as unavailable", async () => {
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const { kernel, bus } = await platform(
      [fragment(NOTES, { commands: [command(operation("slow"))] })],
      {
        [NOTES]: {
          slow: () => {
            started();
            return new Promise(() => {});
          },
        },
      },
    );
    const call = bus.call(`${NOTES}/slow`);
    await running;
    await kernel.disable(NOTES);
    const error = await call.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CommandCallError);
    expect((error as CommandCallError).kind).toBe("unavailable");
  });

  it("tells observers when the catalogue changes", async () => {
    const { kernel, bus } = await platform([
      fragment(NOTES, { commands: [command(operation("list"))] }),
    ]);
    const seen: string[][] = [];
    const stop = bus.observe((commands) => seen.push(commands.map((c) => c.id)));
    await kernel.disable(NOTES);
    await kernel.enable(NOTES);
    stop();
    await kernel.disable(NOTES);
    expect(seen).toEqual([[`${NOTES}/list`], [], [`${NOTES}/list`]]);
  });

  it("deactivating system.commands empties the bus", async () => {
    const { kernel, bus } = await platform([
      fragment(NOTES, { commands: [command(operation("list"))] }),
    ]);
    await kernel.deactivate("client");
    expect(bus.list()).toEqual([]);
    await expect(bus.call(`${NOTES}/list`)).rejects.toMatchObject({ kind: "unknown-command" });
  });
});
