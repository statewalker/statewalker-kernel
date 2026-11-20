// @vitest-environment jsdom
// Decisions accepted in statewalker-root#153: strict validation, bindable props, no unions.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ConfirmCard, PROTO_CATALOG_ID, protoCatalog, protoRegistry } from "./catalog.js";
import { defineComponent } from "./define-component.js";
import { createProcessor } from "./processor.js";
import { A2uiSurface } from "./renderer.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const create = (components: Record<string, unknown>[], dataModel?: unknown): any => ({
  version: "1.0",
  createSurface: {
    surfaceId: "s",
    catalogId: PROTO_CATALOG_ID,
    components,
    ...(dataModel ? { dataModel } : {}),
  },
});

async function mount(surface: Parameters<typeof A2uiSurface>[0]["surface"]) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<A2uiSurface surface={surface} registry={protoRegistry} />));
  return { host, root };
}

describe("STRICT_VALIDATION", () => {
  it("rejects an unknown component type on input", () => {
    const processor = createProcessor([protoCatalog]);
    const errors = processor.processMessagesWithErrors(
      create([
        { id: "root", component: "Column", children: ["x"] },
        { id: "x", component: "EvilWidget", html: "<b>pwn</b>" },
      ]),
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(processor.getSurface("s")?.componentsModel.get("x")).toBeUndefined();
  });
});

describe("bindable props", () => {
  it("emits A2UI dynamic types: a literal or a data binding", () => {
    const title = (ConfirmCard.catalogEntry.properties as Record<string, unknown>).title;
    expect(title).toEqual({ $ref: "common_types.json#/$defs/DynamicString" });
    const api = protoCatalog.components.get("ConfirmCard");
    const ok = { body: "b", confirmLabel: "ok" };
    expect(api?.schema.safeParse({ ...ok, title: "t" }).success).toBe(true);
    expect(api?.schema.safeParse({ ...ok, title: { "@path": "/t" } }).success).toBe(true);
    expect(api?.schema.safeParse({ ...ok, title: 1 }).success).toBe(false);
  });

  it("renders the bound value and follows data-model updates from the agent", async () => {
    const processor = createProcessor([protoCatalog]);
    const errors = processor.processMessagesWithErrors(
      create(
        [
          {
            id: "root",
            component: "ConfirmCard",
            title: { "@path": "/req/title" },
            body: "b",
            confirmLabel: "OK",
          },
        ],
        { req: { title: "Delete 3 files?" } },
      ),
    );
    expect(errors).toEqual([]);
    const { host, root } = await mount(processor.getSurface("s")!);
    expect(host.querySelector("h3")?.textContent).toBe("Delete 3 files?");
    await act(async () => {
      processor.processMessages({
        version: "1.0",
        updateDataModel: { surfaceId: "s", path: "/req/title", value: "Delete 4 files?" },
      });
    });
    expect(host.querySelector("h3")?.textContent).toBe("Delete 4 files?");
    root.unmount();
  });

  it("a bound value of the wrong type is refused at render (the data model is untyped)", async () => {
    const processor = createProcessor([protoCatalog]);
    processor.processMessages(
      create(
        [
          {
            id: "root",
            component: "ConfirmCard",
            title: { "@path": "/n" },
            body: "b",
            confirmLabel: "OK",
          },
        ],
        { n: 42 },
      ),
    );
    const { host, root } = await mount(processor.getSurface("s")!);
    expect(host.querySelector("[data-a2ui-invalid='ConfirmCard']")).not.toBeNull();
    expect(host.querySelector("h3")).toBeNull();
    root.unmount();
  });
});

describe("defineComponent refuses unions in props", () => {
  const def = (props: z.ZodObject) => () =>
    defineComponent({ name: "U", props, events: z.object({}), render: () => null });

  it("refuses a top-level union", () => {
    expect(def(z.object({ v: z.union([z.string(), z.number()]) }))).toThrow(/union/i);
  });
  it("refuses a nested union", () => {
    expect(
      def(z.object({ items: z.array(z.object({ v: z.union([z.string(), z.number()]) })) })),
    ).toThrow(/union/i);
  });
  it("refuses a discriminated union", () => {
    const u = z.discriminatedUnion("k", [
      z.object({ k: z.literal("a") }),
      z.object({ k: z.literal("b") }),
    ]);
    expect(def(z.object({ v: u }))).toThrow(/union/i);
  });
  it("still accepts nullable", () => {
    expect(def(z.object({ v: z.string().nullable() }))).not.toThrow();
  });
});
