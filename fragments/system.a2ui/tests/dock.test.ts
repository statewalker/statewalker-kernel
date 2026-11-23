// Seam 1: system.a2ui beside system.commands and system.workbench, wired as the shell wires them
// (the workbench's surface source is `createSurfaceDock`); surfaces move between their place and
// the dock through the model, the commands and the workbench.
import { createKernel } from "@statewalker/kernel.core";
import {
  createSystemCommands,
  SYSTEM_COMMANDS_ID,
  systemCommandsArchive,
} from "@statewalker/system.commands";
import {
  createSystemWorkbench,
  SYSTEM_WORKBENCH_ID,
  systemWorkbenchArchive,
} from "@statewalker/system.workbench";
import { describe, expect, it } from "vitest";
import { createSurfaceDock } from "../client/index.js";
import {
  createSystemA2ui,
  PLATFORM_CATALOG_ID,
  SYSTEM_A2UI_ID,
  systemA2uiArchive,
} from "../src/index.js";

async function platform() {
  const commands = createSystemCommands();
  const workbench = createSystemWorkbench();
  const system = createSystemA2ui({ commands: commands.bus });
  const kernel = createKernel({
    platform: { version: "1.0.0", bindings: [] },
    core: [systemCommandsArchive, systemWorkbenchArchive, systemA2uiArchive],
    resolvers: {
      module: (ref, { contributor }) =>
        contributor.id === SYSTEM_WORKBENCH_ID
          ? workbench.module[ref.export ?? "default"]
          : undefined,
    },
    activators: {
      client: (f, context) => {
        if (f.id === SYSTEM_COMMANDS_ID) return commands.activate(context);
        if (f.id === SYSTEM_WORKBENCH_ID) return workbench.activate(context);
        if (f.id === SYSTEM_A2UI_ID) return system.activate(context);
        return undefined;
      },
    },
  });
  await kernel.start();
  await kernel.activate("client");
  workbench.workbench.setSurfaceSource(createSurfaceDock(system.a2ui));
  await system.a2ui.process(
    {
      version: "1.0",
      createSurface: {
        surfaceId: "s",
        catalogId: PLATFORM_CATALOG_ID,
        components: [{ id: "root", component: "Text", text: "Hello" }],
      },
    },
    { origin: "agent", title: "Greeting" },
  );
  return { kernel, bus: commands.bus, workbench: workbench.workbench, a2ui: system.a2ui };
}

const createS = (text: string) => ({
  version: "1.0",
  createSurface: {
    surfaceId: "s",
    catalogId: PLATFORM_CATALOG_ID,
    components: [{ id: "root", component: "Text", text }],
  },
});

const placement = (a2ui: Awaited<ReturnType<typeof platform>>["a2ui"]) =>
  a2ui.surfaces().find((s) => s.id === "s")?.placement;

describe("surfaces and the workbench's dock", () => {
  it("a surface popped out is docked under its title, and popped back in leaves the dock", async () => {
    const { workbench, a2ui } = await platform();
    await a2ui.popOut("s");
    expect(workbench.docked().map((d) => [d.surfaceId, d.title])).toEqual([["s", "Greeting"]]);
    expect(placement(a2ui)).toBe("docked");
    await expect(workbench.docked()[0]?.component()).resolves.toBeTypeOf("function");
    await a2ui.popIn("s");
    expect(workbench.docked()).toEqual([]);
    expect(placement(a2ui)).toBe("inline");
  });

  it("system.workbench/open-surface docks it; the user closing the dock's panel takes it back", async () => {
    const { bus, workbench, a2ui } = await platform();
    await bus.call("system.workbench/open-surface", { surfaceId: "s" });
    expect(placement(a2ui)).toBe("docked");
    workbench.closeSurface("s"); // what closing the panel does
    expect(placement(a2ui)).toBe("inline");
  });

  it("refuses to dock a surface the model does not hold", async () => {
    const { bus, workbench } = await platform();
    await expect(
      bus.call("system.workbench/open-surface", { surfaceId: "nope" }),
    ).rejects.toThrow();
    expect(workbench.docked()).toEqual([]);
  });

  it("a docked surface deleted by its sender leaves the dock; one re-created under its id starts inline and pops out", async () => {
    const { workbench, a2ui } = await platform();
    await a2ui.popOut("s");
    await a2ui.process({ version: "1.0", deleteSurface: { surfaceId: "s" } }, { origin: "agent" });
    expect(a2ui.surface("s")).toBeUndefined();
    expect(workbench.docked()).toEqual([]);

    const { errors } = await a2ui.process(createS("again"), { origin: "agent", title: "Again" });
    expect(errors).toEqual([]);
    expect(placement(a2ui)).toBe("inline");
    await a2ui.popOut("s");
    expect(workbench.docked().map((d) => [d.surfaceId, d.title])).toEqual([["s", "Again"]]);
    expect(placement(a2ui)).toBe("docked");
  });

  it("a docked surface removed by the host leaves the dock", async () => {
    const { workbench, a2ui } = await platform();
    await a2ui.popOut("s");
    a2ui.delete("s");
    expect(workbench.docked()).toEqual([]);
  });

  it("deactivating system.a2ui empties the dock of its surfaces", async () => {
    const { kernel, workbench, a2ui } = await platform();
    await a2ui.popOut("s");
    await kernel.deactivate("client", SYSTEM_A2UI_ID);
    expect(workbench.docked()).toEqual([]);
  });
});
