// Seam 1: the real kernel with system.workbench as a core fragment; observed through the
// workbench model (the views point's owner) and the kernel's public slots.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  activeFragmentsSlot,
  createKernel,
  type ExtensionRefusal,
  extensionRefusalsSlot,
  parseJsonc,
} from "@statewalker/kernel.core";
import { describe, expect, it } from "vitest";
import {
  createSystemWorkbench,
  SYSTEM_WORKBENCH_ID,
  systemWorkbenchArchive,
  WorkbenchError,
  type WorkbenchState,
} from "../src/index.js";

const NOTES = "org.example.notes";
const TODO = "org.example.todo";
const SCHEMA = "https://example.org/schemas/fragment.v1.schema.json";
const ASPECT_SCHEMA = "https://example.org/schemas/fragment-aspect.v1.schema.json";

/** A client-only fragment contributing these views, each a module export of the same name. */
function fragment(id: string, views: Record<string, unknown>[]): Record<string, string> {
  return {
    "fragment.jsonc": JSON.stringify({
      $schema: SCHEMA,
      id,
      version: "1.0.0",
      engines: { platform: "^1.0.0" },
      aspects: { client: {} },
    }),
    "fragment.client.jsonc": JSON.stringify({
      $schema: ASPECT_SCHEMA,
      extensions: views.map((data) => ({
        point: "views",
        data,
        reference: { module: "./index.js", export: String(data.id) },
      })),
    }),
  };
}

/** The kernel with system.workbench as its core fragment, these fragments enabled and active. */
async function platform(archives: Record<string, string>[]) {
  const system = createSystemWorkbench();
  const kernel = createKernel({
    platform: { version: "1.0.0", bindings: [] },
    core: [systemWorkbenchArchive],
    resolvers: { module: (ref, { contributor }) => `${contributor.id}#${ref.export}` },
    activators: {
      client: (f, context) => (f.id === SYSTEM_WORKBENCH_ID ? system.activate(context) : undefined),
    },
  });
  await kernel.start();
  for (const f of await kernel.install(archives)) await kernel.enable(f.id);
  await kernel.activate("client");
  const states: WorkbenchState[] = [];
  system.workbench.observe((state) => states.push(state));
  return { kernel, workbench: system.workbench, states };
}

const ids = (state: WorkbenchState) => state.views.map((v) => v.id);

describe("the system.workbench fragment", () => {
  it("is a core fragment the kernel installs and activates", async () => {
    const { kernel } = await platform([]);
    expect([...kernel.slots.getSnapshot(activeFragmentsSlot("client")).keys()]).toEqual([
      SYSTEM_WORKBENCH_ID,
    ]);
  });

  it("ships the archive its folder holds", () => {
    const root = join(import.meta.dirname, "..");
    for (const file of ["fragment.jsonc", "fragment.client.jsonc"]) {
      const onDisk = parseJsonc(readFileSync(join(root, file), "utf8")).value;
      expect(onDisk).toEqual(JSON.parse(systemWorkbenchArchive[file] ?? "null"));
    }
  });
});

describe("the views point", () => {
  it("lists every contributed view under its identity, with its title and contributor", async () => {
    const { workbench } = await platform([
      fragment(NOTES, [{ id: "notes", title: "Notes" }]),
      fragment(TODO, [{ id: "list", title: "To do" }]),
    ]);
    expect(workbench.views().map(({ id, title, fragment }) => ({ id, title, fragment }))).toEqual([
      { id: `${NOTES}/notes`, title: "Notes", fragment: NOTES },
      { id: `${TODO}/list`, title: "To do", fragment: TODO },
    ]);
    expect(workbench.opened()).toEqual([]);
  });

  it("resolves a view's component through its lazy reference", async () => {
    const { workbench } = await platform([fragment(NOTES, [{ id: "notes", title: "Notes" }])]);
    const view = workbench.view(`${NOTES}/notes`);
    await expect(view?.component()).resolves.toBe(`${NOTES}#notes`);
  });

  it("refuses a view whose data breaks the point's schema, with a reason", async () => {
    const { kernel, workbench } = await platform([
      fragment(NOTES, [
        { id: "Bad Id", title: "x" },
        { id: "no-title" },
        { id: "ok", title: "Ok" },
      ]),
    ]);
    expect(workbench.views().map((v) => v.id)).toEqual([`${NOTES}/ok`]);
    const refused: ExtensionRefusal[] = [
      ...kernel.slots.getSnapshot(extensionRefusalsSlot("client")).values(),
    ];
    expect(refused).toHaveLength(2);
    for (const r of refused) expect(r).toMatchObject({ contributor: NOTES, point: "views" });
  });
});

describe("opening and closing views", () => {
  it("opens a view once, and closes it", async () => {
    const { workbench, states } = await platform([
      fragment(NOTES, [{ id: "notes", title: "Notes" }]),
    ]);
    workbench.open(`${NOTES}/notes`);
    workbench.open(`${NOTES}/notes`);
    expect(workbench.opened()).toEqual([`${NOTES}/notes`]);
    workbench.close(`${NOTES}/notes`);
    expect(workbench.opened()).toEqual([]);
    expect(states.map((s) => s.opened)).toEqual([[], [`${NOTES}/notes`], []]);
  });

  it("refuses to open a view nobody contributes", async () => {
    const { workbench } = await platform([]);
    expect(() => workbench.open(`${NOTES}/notes`)).toThrow(WorkbenchError);
    expect(workbench.opened()).toEqual([]);
  });

  it("closes a view, and drops it, when its fragment is disabled; other views stay", async () => {
    const { kernel, workbench, states } = await platform([
      fragment(NOTES, [{ id: "notes", title: "Notes" }]),
      fragment(TODO, [{ id: "list", title: "To do" }]),
    ]);
    workbench.open(`${NOTES}/notes`);
    workbench.open(`${TODO}/list`);
    await kernel.disable(NOTES);
    expect(ids(states.at(-1) as WorkbenchState)).toEqual([`${TODO}/list`]);
    expect(workbench.opened()).toEqual([`${TODO}/list`]);
    await kernel.enable(NOTES);
    expect(workbench.views().map((v) => v.id)).toEqual([`${TODO}/list`, `${NOTES}/notes`]);
    expect(workbench.opened()).toEqual([`${TODO}/list`]);
  });

  it("empties when system.workbench's client aspect is deactivated", async () => {
    const { kernel, workbench } = await platform([
      fragment(NOTES, [{ id: "notes", title: "Notes" }]),
    ]);
    workbench.open(`${NOTES}/notes`);
    await kernel.deactivate("client", SYSTEM_WORKBENCH_ID);
    expect(workbench.views()).toEqual([]);
    expect(workbench.opened()).toEqual([]);
  });
});
