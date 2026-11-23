// Seam 1: surfaces popped out into the workbench's dock, by the model and through the
// `system.workbench/open-surface` and `close-surface` commands on system.commands' bus.
import { createKernel } from "@statewalker/kernel.core";
import {
  type CommandCallError,
  createSystemCommands,
  SYSTEM_COMMANDS_ID,
  systemCommandsArchive,
} from "@statewalker/system.commands";
import { describe, expect, it } from "vitest";
import {
  createSystemWorkbench,
  type SurfaceSource,
  SYSTEM_WORKBENCH_ID,
  systemWorkbenchArchive,
  WorkbenchError,
} from "../src/index.js";

/** A source holding the surfaces `ids`, recording what the dock tells it. */
function source(ids: string[]) {
  const docked: [string, boolean][] = [];
  const surfaces: SurfaceSource = {
    title: (id) => (ids.includes(id) ? `Surface ${id}` : undefined),
    component: (id) => `component of ${id}`,
    docked: (id, isDocked) => void docked.push([id, isDocked]),
  };
  return { surfaces, docked };
}

async function platform() {
  const commands = createSystemCommands();
  const system = createSystemWorkbench();
  const kernel = createKernel({
    platform: { version: "1.0.0", bindings: [] },
    core: [systemCommandsArchive, systemWorkbenchArchive],
    resolvers: {
      // A core fragment's references name its in-process module.
      module: (ref, { contributor }) =>
        contributor.id === SYSTEM_WORKBENCH_ID ? system.module[ref.export ?? "default"] : undefined,
    },
    activators: {
      client: (f, context) => {
        if (f.id === SYSTEM_COMMANDS_ID) return commands.activate(context);
        if (f.id === SYSTEM_WORKBENCH_ID) return system.activate(context);
        return undefined;
      },
    },
  });
  await kernel.start();
  await kernel.activate("client");
  return { kernel, bus: commands.bus, workbench: system.workbench };
}

describe("the dock", () => {
  it("refuses a surface while nothing provides surfaces, or one its source does not hold", async () => {
    const { workbench } = await platform();
    expect(() => workbench.openSurface("s")).toThrow(WorkbenchError);
    workbench.setSurfaceSource(source(["s"]).surfaces);
    expect(() => workbench.openSurface("other")).toThrow(WorkbenchError);
    expect(workbench.docked()).toEqual([]);
  });

  it("docks a surface once, beside the views, and tells its source", async () => {
    const { workbench } = await platform();
    const { surfaces, docked } = source(["s"]);
    workbench.setSurfaceSource(surfaces);
    workbench.openSurface("s");
    workbench.openSurface("s");
    expect(
      workbench.docked().map(({ id, surfaceId, title }) => ({ id, surfaceId, title })),
    ).toEqual([{ id: "surface:s", surfaceId: "s", title: "Surface s" }]);
    await expect(workbench.docked()[0]?.component()).resolves.toBe("component of s");
    expect(workbench.opened()).toEqual([]);
    workbench.closeSurface("s");
    expect(workbench.docked()).toEqual([]);
    expect(docked).toEqual([
      ["s", true],
      ["s", false],
    ]);
  });

  it("takes the title given", async () => {
    const { workbench } = await platform();
    workbench.setSurfaceSource(source(["s"]).surfaces);
    workbench.openSurface("s", { title: "Answer me" });
    expect(workbench.docked()[0]?.title).toBe("Answer me");
  });

  it("opens and closes surfaces through its commands on the bus", async () => {
    const { bus, workbench } = await platform();
    const { surfaces, docked } = source(["s"]);
    workbench.setSurfaceSource(surfaces);
    await expect(bus.call("system.workbench/open-surface", { surfaceId: "s" })).resolves.toEqual(
      {},
    );
    expect(workbench.docked().map((d) => d.surfaceId)).toEqual(["s"]);
    await expect(bus.call("system.workbench/close-surface", { surfaceId: "s" })).resolves.toEqual(
      {},
    );
    expect(workbench.docked()).toEqual([]);
    expect(docked).toEqual([
      ["s", true],
      ["s", false],
    ]);
    const failure = await bus.call("system.workbench/open-surface", { surfaceId: "nope" }).then(
      () => undefined,
      (error: CommandCallError) => error,
    );
    expect(failure).toBeDefined();
    expect(workbench.docked()).toEqual([]);
  });

  it("empties when system.workbench's client aspect is deactivated", async () => {
    const { kernel, workbench } = await platform();
    const { surfaces, docked } = source(["s"]);
    workbench.setSurfaceSource(surfaces);
    workbench.openSurface("s");
    await kernel.deactivate("client", SYSTEM_WORKBENCH_ID);
    expect(workbench.docked()).toEqual([]);
    expect(docked.at(-1)).toEqual(["s", false]);
  });
});
