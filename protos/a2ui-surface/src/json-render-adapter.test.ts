import { MessageProcessor } from "@a2ui/web_core";
import { describe, expect, it } from "vitest";
import { buildCatalog } from "./define-component.js";
import { importJsonRenderCatalog, jsonRenderPropsFromEntry } from "./json-render-adapter.js";
import { legacyJsonRenderCatalog } from "./legacy-json-render-catalog.js";

describe("json-render catalog → A2UI catalog entries (migration tool)", () => {
  const entries = importJsonRenderCatalog(legacyJsonRenderCatalog);

  it("imports each json-render component as an A2UI component entry", () => {
    expect(entries.map((e) => e.name)).toEqual(["StatusBadge"]);
    expect(entries[0]?.catalogEntry).toMatchObject({
      description: "A small status badge",
      properties: {
        component: { const: "StatusBadge" },
        label: { type: "string" },
        // zod 4 emits nullable as anyOf[…, null]; web_core's JSON Schema → zod 3
        // derivation accepts ANY value for anyOf, so the entry is normalized to a type array.
        tone: { type: ["string", "null"], enum: ["ok", "warn", "error", null] },
      },
    });
  });

  it("the imported entry validates surfaces in web_core like the json-render props did", () => {
    const catalog = buildCatalog({ catalogId: "migrated", basic: ["Column"], components: entries });
    const p = new MessageProcessor([catalog]);
    const ok = p.processMessagesWithErrors({
      version: "1.0",
      createSurface: {
        surfaceId: "s",
        catalogId: "migrated",
        components: [{ id: "root", component: "StatusBadge", label: "Build", tone: "ok" }],
      },
    });
    expect(ok).toEqual([]);
    const bad = new MessageProcessor([catalog]).processMessagesWithErrors({
      version: "1.0",
      createSurface: {
        surfaceId: "s",
        catalogId: "migrated",
        components: [{ id: "root", component: "StatusBadge", label: "Build", tone: "purple" }],
      },
    });
    expect(bad.length).toBeGreaterThan(0);
  });

  it("round trip: A2UI entry → json-render props schema accepts/rejects the same values", () => {
    const original = legacyJsonRenderCatalog.data.components.StatusBadge.props;
    const back = jsonRenderPropsFromEntry(entries[0]!.catalogEntry);
    const samples = [
      { label: "Build", tone: "ok" },
      { label: "Build", tone: null },
      { label: "Build", tone: "purple" },
      { tone: "ok" },
    ];
    for (const s of samples) {
      expect(back.safeParse(s).success, JSON.stringify(s)).toBe(original.safeParse(s).success);
    }
  });
});
