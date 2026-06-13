import { Commands } from "@statewalker/shared-commands";
import { describe, expect, it } from "vitest";
import { Workspace } from "../public/types/workspace.js";

describe("Commands as a workspace adapter", () => {
  it("requireAdapter(Commands) auto-instantiates without explicit setAdapter", () => {
    const ws = new Workspace();
    const bus = ws.requireAdapter(Commands);
    expect(bus).toBeInstanceOf(Commands);
  });

  it("two consecutive requireAdapter(Commands) calls return the same identity", () => {
    const ws = new Workspace();
    const a = ws.requireAdapter(Commands);
    const b = ws.requireAdapter(Commands);
    expect(a).toBe(b);
  });

  it("auto-instantiation cycle-detection allows Commands (constructor does no recursive requireAdapter)", () => {
    const ws = new Workspace();
    expect(() => ws.requireAdapter(Commands)).not.toThrow();
  });

  it("dispatch through the workspace-bound bus reaches listeners registered through it", async () => {
    const ws = new Workspace();
    const bus = ws.requireAdapter(Commands);

    const mod = await import("@statewalker/shared-commands");
    const HelloCommand = mod.Command.silent("hello")
      .input(mod.passthrough<{ msg: string }>())
      .output(mod.passthrough<void>())
      .build();

    let received: string | null = null;
    bus.listen(HelloCommand, (cmd) => {
      received = cmd.payload.msg;
      return true;
    });

    bus.call(HelloCommand, { msg: "hi" });
    await Promise.resolve();
    expect(received).toBe("hi");
  });
});
