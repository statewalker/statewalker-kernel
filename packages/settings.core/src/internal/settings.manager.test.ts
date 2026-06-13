import { Commands } from "@statewalker/shared-commands";
import { Slots } from "@statewalker/shared-slots";
import { Workspace } from "@statewalker/workspace.core";
import { describe, expect, it } from "vitest";
import { CloseSettingsCommand, OpenSettingsCommand, Settings, settingsTabSlot } from "../index.js";
import { SettingsManager } from "./settings.manager.js";

function makeWorkspace(): { ws: Workspace; manager: SettingsManager } {
  const ws = new Workspace();
  ws.setAdapter(Settings);
  const manager = new SettingsManager({ workspace: ws });
  return { ws, manager };
}

describe("SettingsManager", () => {
  it("runOpenSettings flips Settings.isOpen and writes activeTabId", async () => {
    const { ws, manager } = makeWorkspace();
    const commands = ws.requireAdapter(Commands);
    const settings = ws.requireAdapter(Settings);

    expect(settings.isOpen).toBe(false);
    await commands.call(OpenSettingsCommand, { tabId: "providers" }).promise;
    expect(settings.isOpen).toBe(true);
    expect(settings.activeTabId).toBe("providers");

    await manager.close();
  });

  it("runCloseSettings flips Settings.isOpen back", async () => {
    const { ws, manager } = makeWorkspace();
    const commands = ws.requireAdapter(Commands);
    const settings = ws.requireAdapter(Settings);

    await commands.call(OpenSettingsCommand, {}).promise;
    expect(settings.isOpen).toBe(true);
    await commands.call(CloseSettingsCommand, undefined).promise;
    expect(settings.isOpen).toBe(false);

    await manager.close();
  });

  it("setActiveTab notifies subscribers", () => {
    const { ws, manager } = makeWorkspace();
    const settings = ws.requireAdapter(Settings);
    let updates = 0;
    const dispose = settings.onUpdate(() => {
      updates += 1;
    });

    settings.setActiveTab("providers");
    expect(settings.activeTabId).toBe("providers");
    expect(updates).toBe(1);

    // Same id → no-op, no notify.
    settings.setActiveTab("providers");
    expect(updates).toBe(1);

    dispose();
    void manager.close();
  });

  it("settings:tabs slot accepts contributions from any fragment", () => {
    const { ws, manager } = makeWorkspace();
    const slots = ws.requireAdapter(Slots);

    let observed: ReadonlyArray<{ id: string }> = [];
    const stop = slots.observe(settingsTabSlot, (vs) => {
      observed = vs;
    });

    const dispose = slots.provide(settingsTabSlot, {
      id: "test-tab",
      title: "Test",
      viewKey: "test:view",
    });
    expect(observed.map((t) => t.id)).toContain("test-tab");

    dispose();
    expect(observed.map((t) => t.id)).not.toContain("test-tab");

    stop();
    void manager.close();
  });
});
