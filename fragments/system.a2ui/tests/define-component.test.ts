import { Catalog } from "@a2ui/web_core";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { ComponentProps } from "../src/index.js";
import { ConfirmCard, PROTO_CATALOG_ID, protoCatalog } from "./fixtures/catalog.js";

describe("defineComponent", () => {
  it("generates an A2UI 1.0 catalog entry (JSON Schema) for the component", () => {
    expect(ConfirmCard.name).toBe("ConfirmCard");
    expect(ConfirmCard.catalogEntry).toMatchObject({
      type: "object",
      properties: {
        component: { const: "ConfirmCard" },
        // Bindable (statewalker-root#153): literal | {"@path"} | {"@call"}.
        title: { $ref: "common_types.json#/$defs/DynamicString" },
        body: { $ref: "common_types.json#/$defs/DynamicString" },
        confirmLabel: { $ref: "common_types.json#/$defs/DynamicString" },
      },
      required: expect.arrayContaining(["component", "title", "body", "confirmLabel"]),
    });
  });

  it("is accepted by web_core's Catalog next to basic components", () => {
    expect(protoCatalog).toBeInstanceOf(Catalog);
    expect(protoCatalog.id).toBe(PROTO_CATALOG_ID);
    expect(protoCatalog.protocolVersion).toBe("1.0");
    expect([...protoCatalog.components.keys()]).toEqual(
      expect.arrayContaining(["Text", "Column", "Button", "ConfirmCard"]),
    );
    const doc = protoCatalog.toJson() as { components: Record<string, unknown> };
    expect(doc.components.ConfirmCard).toMatchObject({
      properties: { component: { const: "ConfirmCard" } },
    });
    // The web_core-side zod 3 schema derived from our JSON Schema validates props
    // (web_core strips the `component` discriminator from the derived schema, as for Text).
    const api = protoCatalog.components.get("ConfirmCard");
    expect(api?.schema.safeParse({ title: "t", body: "b", confirmLabel: "ok" }).success).toBe(true);
    expect(api?.schema.safeParse({ title: 1 }).success).toBe(false);
    expect(api?.schema.safeParse({ title: "t", body: "b", confirmLabel: "ok", x: 1 }).success).toBe(
      false,
    );
  });

  it("infers the props type from the Zod schema", () => {
    expectTypeOf<ComponentProps<typeof ConfirmCard>>().toEqualTypeOf<{
      title: string;
      body: string;
      confirmLabel: string;
    }>();
  });
});
