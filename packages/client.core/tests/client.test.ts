// The client API as a fragment's client half sees it: one module whose bindings the host installs.
import { afterEach, describe, expect, it } from "vitest";
import { ClientApiError, type ClientCommands, commands, installClient } from "../src/index.js";

function fakeBus(): ClientCommands & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const listed = [{ id: "org.example.notes/add-note" }];
  return {
    calls,
    async call<T>(id: string, input?: unknown) {
      calls.push([id, input]);
      return { ok: id } as T;
    },
    list: () => listed,
    observe(listener) {
      listener(listed);
      return () => {};
    },
  };
}

let uninstall: (() => void) | undefined;
afterEach(() => {
  uninstall?.();
  uninstall = undefined;
});

describe("the client API", () => {
  it("refuses every call until the host installs it", async () => {
    await expect(commands.call("org.example.notes/add-note")).rejects.toBeInstanceOf(
      ClientApiError,
    );
    expect(() => commands.list()).toThrow(ClientApiError);
    expect(() => commands.observe(() => {})).toThrow(ClientApiError);
  });

  it("reaches the host's command bus once installed", async () => {
    const bus = fakeBus();
    uninstall = installClient({ commands: bus });
    await expect(commands.call("org.example.notes/add-note", { text: "a" })).resolves.toEqual({
      ok: "org.example.notes/add-note",
    });
    expect(bus.calls).toEqual([["org.example.notes/add-note", { text: "a" }]]);
    expect(commands.list().map((c) => c.id)).toEqual(["org.example.notes/add-note"]);
    const seen: string[][] = [];
    commands.observe((all) => seen.push(all.map((c) => c.id)));
    expect(seen).toEqual([["org.example.notes/add-note"]]);
  });

  it("takes one host at a time", () => {
    uninstall = installClient({ commands: fakeBus() });
    expect(() => installClient({ commands: fakeBus() })).toThrow(ClientApiError);
    uninstall();
    uninstall = installClient({ commands: fakeBus() });
    expect(commands.list()).toHaveLength(1);
  });
});
