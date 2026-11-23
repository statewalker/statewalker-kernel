// Seam 1: the real kernel with system.a2ui as a core fragment and a fragment contributing
// catalog components; observed through the A2UI model (the catalog point's owner), the
// surfaces it holds, and the commands its events call.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createKernel, extensionRefusalsSlot, parseJsonc } from "@statewalker/kernel.core";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  BASIC_COMPONENTS,
  createSystemA2ui,
  defineComponent,
  emitComponentEvent,
  PLATFORM_CATALOG_ID,
  SYSTEM_A2UI_ID,
  type SystemA2uiOptions,
  systemA2uiArchive,
} from "../src/index.js";
import { createTestBus } from "./fixtures/bus.js";

const FORMS = "org.example.forms";
const SCHEMA = "https://example.org/schemas/fragment.v1.schema.json";
const ASPECT_SCHEMA = "https://example.org/schemas/fragment-aspect.v1.schema.json";
const SUBMIT = `${FORMS}/submit`;

const Question = defineComponent({
  name: "Question",
  props: z.object({ label: z.string(), answer: z.string() }),
  events: z.object({ submit: z.object({ answer: z.string() }) }),
  commands: { submit: SUBMIT },
  render: () => null,
});
const NotAComponent = { name: "Fake" };
/** A definition contributed under a name that is not its own. */
const Renamed = defineComponent({
  name: "Other",
  props: z.object({}),
  events: z.object({}),
  render: () => null,
});
/** A contribution trying to replace a basic component. */
const FakeText = defineComponent({
  name: "Text",
  props: z.object({ text: z.string() }),
  events: z.object({}),
  render: () => null,
});

const EXPORTS: Record<string, unknown> = { Question, NotAComponent, Renamed, FakeText };

/** A client-only fragment contributing catalog components, each a module export. */
function fragment(id: string, entries: { name: string; export: string }[]) {
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
      extensions: entries.map((e) => ({
        point: "catalog",
        data: { name: e.name },
        reference: { module: "./index.js", export: e.export },
      })),
    }),
  };
}

async function platform(
  entries: { name: string; export: string }[] = [{ name: "Question", export: "Question" }],
  options: Partial<SystemA2uiOptions> = {},
) {
  const bus = createTestBus();
  const system = createSystemA2ui({ commands: bus, ...options });
  const kernel = createKernel({
    platform: { version: "1.0.0", bindings: [] },
    core: [systemA2uiArchive],
    resolvers: { module: (ref) => EXPORTS[ref.export ?? "default"] },
    activators: {
      client: (f, context) => (f.id === SYSTEM_A2UI_ID ? system.activate(context) : undefined),
    },
  });
  await kernel.start();
  for (const f of await kernel.install([fragment(FORMS, entries)])) await kernel.enable(f.id);
  await kernel.activate("client");
  await system.a2ui.ready();
  return { kernel, a2ui: system.a2ui, bus };
}

const create = (surfaceId: string, components: Record<string, unknown>[], dataModel?: unknown) => ({
  version: "1.0",
  createSurface: {
    surfaceId,
    catalogId: PLATFORM_CATALOG_ID,
    components,
    ...(dataModel ? { dataModel } : {}),
  },
});

const question = (extra: Record<string, unknown> = {}) => [
  { id: "root", component: "Column", children: ["q"] },
  { id: "q", component: "Question", label: "Name?", answer: { "@path": "/answer" }, ...extra },
];

describe("the system.a2ui fragment", () => {
  it("ships the archive its folder holds", () => {
    const root = join(import.meta.dirname, "..");
    for (const file of ["fragment.jsonc", "fragment.client.jsonc"]) {
      const onDisk = parseJsonc(readFileSync(join(root, file), "utf8")).value;
      expect(onDisk).toEqual(JSON.parse(systemA2uiArchive[file] ?? "null"));
    }
  });
});

describe("the catalog point", () => {
  it("offers the basic components and the contributed ones under the platform catalog", async () => {
    const { a2ui } = await platform();
    expect(a2ui.catalog().id).toBe(PLATFORM_CATALOG_ID);
    expect([...a2ui.catalog().components.keys()].sort()).toEqual(
      [...BASIC_COMPONENTS, "Question"].sort(),
    );
    expect(a2ui.components().map((c) => c.name)).toEqual(["Question"]);
  });

  it("refuses a contribution that is no definition, is named otherwise, or replaces a basic one", async () => {
    const { kernel, a2ui } = await platform([
      { name: "Fake", export: "NotAComponent" },
      { name: "Renamed", export: "Renamed" },
      { name: "Text", export: "FakeText" },
      { name: "lower", export: "Question" },
      { name: "Question", export: "Question" },
    ]);
    expect(a2ui.components().map((c) => c.name)).toEqual(["Question"]);
    expect(a2ui.refusals().map((r) => r.name)).toEqual(["Fake", "Renamed", "Text"]);
    // A name breaking the point's schema is refused by the kernel itself.
    const refused = [...kernel.slots.getSnapshot(extensionRefusalsSlot("client")).values()];
    expect(refused).toHaveLength(1);
  });

  it("drops a fragment's components when it is disabled; new surfaces can no longer place them", async () => {
    const { kernel, a2ui } = await platform();
    await kernel.disable(FORMS);
    expect(a2ui.components()).toEqual([]);
    const { errors } = await a2ui.process(create("s", question()), { origin: "agent" });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("surfaces", () => {
  it("are created from A2UI 1.0 messages placing catalog components", async () => {
    const { a2ui } = await platform();
    const result = await a2ui.process(create("s", question(), { answer: "" }), {
      origin: "agent",
      title: "A question",
    });
    expect(result).toEqual({ surfaceIds: ["s"], errors: [] });
    expect(a2ui.surface("s")?.componentsModel.get("q")?.type).toBe("Question");
    expect(a2ui.surfaces()).toEqual([
      { id: "s", origin: "agent", title: "A question", placement: "inline" },
    ]);
  });

  it("refuse an unknown component, and raw HTML or script in props, on input", async () => {
    const { a2ui } = await platform();
    for (const components of [
      [
        { id: "root", component: "Column", children: ["x"] },
        { id: "x", component: "Html", html: "<script>alert(1)</script>" },
      ],
      [{ id: "root", component: "script", src: "https://evil.example/x.js" }],
      question({ dangerouslySetInnerHTML: { __html: "<img src=x onerror=alert(1)>" } }),
      question({ onclick: "alert(1)" }),
      // A basic component web_core knows but the platform does not render.
      [{ id: "root", component: "Slider", max: 10, value: 3 }],
    ]) {
      const { errors } = await a2ui.process(create("bad", components), { origin: "agent" });
      expect(errors.length, JSON.stringify(components)).toBeGreaterThan(0);
      expect(a2ui.surface("bad")?.componentsModel.get("x")).toBeUndefined();
      a2ui.delete("bad");
    }
  });

  it("refuse an update to another origin's surface", async () => {
    const { a2ui } = await platform();
    await a2ui.process(create("s", question(), { answer: "" }), { origin: "server" });
    const { errors } = await a2ui.process(
      { version: "1.0", updateDataModel: { surfaceId: "s", path: "/answer", value: "x" } },
      { origin: "agent" },
    );
    expect(errors.length).toBe(1);
    expect(a2ui.surface("s")?.dataModel.get("/answer")).toBe("");
  });

  it("accept A2UI 0.9.1 through the shim, from a mapped legacy catalog id", async () => {
    const { a2ui } = await platform(undefined, {
      legacyCatalogIds: { "legacy-catalog": PLATFORM_CATALOG_ID },
    });
    const { errors } = await a2ui.process(
      [
        { version: "v0.9.1", createSurface: { surfaceId: "old", catalogId: "legacy-catalog" } },
        {
          version: "v0.9.1",
          updateComponents: {
            surfaceId: "old",
            components: [{ id: "root", component: "Text", variant: "h1", text: "Hi" }],
          },
        },
      ],
      { origin: "agent" },
    );
    expect(errors).toEqual([]);
    expect(a2ui.surface("old")?.componentsModel.get("root")?.type).toBe("Text");
  });
});

describe("component events", () => {
  async function submitted(origin: "agent" | "server", options: Partial<SystemA2uiOptions> = {}) {
    const t = await platform(undefined, options);
    const handler = vi.fn(async (input: unknown) => ({ ok: input }));
    t.bus.listen(SUBMIT, handler);
    await t.a2ui.process(create("s", question(), { answer: "" }), { origin });
    const surface = t.a2ui.surface("s");
    if (!surface) throw new Error("no surface");
    await emitComponentEvent(surface, "q", "submit", { answer: "Ada" });
    await vi.waitFor(() => expect(t.a2ui.log.length).toBeGreaterThan(0));
    await vi.waitFor(() => expect(t.a2ui.log.at(-1)?.outcome).not.toBe("asking"));
    return { ...t, handler };
  }

  it("of a server half's surface run the command the component maps them to", async () => {
    const { a2ui, handler } = await submitted("server");
    expect(a2ui.log.at(-1)).toMatchObject({ outcome: "ran", command: SUBMIT });
    expect(handler).toHaveBeenCalledWith({ answer: "Ada" });
  });

  it("of an agent's surface are denied without a policy (fail-closed)", async () => {
    const { a2ui, handler } = await submitted("agent");
    expect(a2ui.log.at(-1)).toMatchObject({ outcome: "denied", command: SUBMIT });
    expect(handler).not.toHaveBeenCalled();
  });

  it("of an agent's surface pass the policy given", async () => {
    const { a2ui, handler } = await submitted("agent", { policy: () => "allow" });
    expect(a2ui.log.at(-1)).toMatchObject({ outcome: "ran" });
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe("placement", () => {
  it("pops a surface out through system.workbench/open-surface and back through close-surface", async () => {
    const { a2ui, bus } = await platform();
    const calls: [string, unknown][] = [];
    bus.listen("system.workbench/open-surface", (input) => {
      calls.push(["open", input]);
      a2ui.setDocked("s", true);
      return {};
    });
    bus.listen("system.workbench/close-surface", (input) => {
      calls.push(["close", input]);
      a2ui.setDocked("s", false);
      return {};
    });
    await a2ui.process(create("s", question(), { answer: "" }), { origin: "agent", title: "Q" });
    const placements: string[] = [];
    a2ui.observe(() => placements.push(a2ui.surfaces()[0]?.placement ?? "none"));
    await a2ui.popOut("s");
    expect(a2ui.surfaces()[0]?.placement).toBe("docked");
    await a2ui.popIn("s");
    expect(a2ui.surfaces()[0]?.placement).toBe("inline");
    expect(calls).toEqual([
      ["open", { surfaceId: "s", title: "Q" }],
      ["close", { surfaceId: "s" }],
    ]);
    expect(placements).toEqual(["inline", "docked", "inline"]);
  });

  it("refuses to pop out a surface it does not hold", async () => {
    const { a2ui } = await platform();
    await expect(a2ui.popOut("nope")).rejects.toThrow(/nope/);
  });
});
