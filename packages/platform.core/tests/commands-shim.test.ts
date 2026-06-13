import { Commands } from "@statewalker/shared-commands";
import { getWorkspace } from "@statewalker/workspace";
import { describe, expect, it, vi } from "vitest";
import { getCommands, removeCommands, setCommands } from "../src/adapters.ts";

describe("getCommands shim", () => {
  it("returns the same instance as workspace.requireAdapter(Commands) for the same ctx", () => {
    const ctx: Record<string, unknown> = {};
    const fromShim = getCommands(ctx);
    const fromWorkspace = getWorkspace(ctx).requireAdapter(Commands);
    expect(fromShim).toBe(fromWorkspace);
  });

  it("returns the same instance across calls on the same ctx", () => {
    const ctx: Record<string, unknown> = {};
    const a = getCommands(ctx);
    const b = getCommands(ctx);
    expect(a).toBe(b);
  });

  it("returns an Commands instance", () => {
    const ctx: Record<string, unknown> = {};
    expect(getCommands(ctx)).toBeInstanceOf(Commands);
  });

  it("returns distinct instances for distinct ctx (each ctx gets its own workspace)", () => {
    const a = getCommands({});
    const b = getCommands({});
    expect(a).not.toBe(b);
  });
});

describe("setCommands / removeCommands — deprecation no-op semantics", () => {
  it("setCommands does not replace the workspace-bound bus", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ctx: Record<string, unknown> = {};
      const original = getCommands(ctx);
      const mock = new Commands();
      setCommands(ctx, mock);
      const after = getCommands(ctx);
      expect(after).toBe(original);
      expect(after).not.toBe(mock);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("removeCommands does not detach the workspace-bound bus", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ctx: Record<string, unknown> = {};
      const original = getCommands(ctx);
      removeCommands(ctx);
      const after = getCommands(ctx);
      expect(after).toBe(original);
      expect(getWorkspace(ctx).requireAdapter(Commands)).toBe(original);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
