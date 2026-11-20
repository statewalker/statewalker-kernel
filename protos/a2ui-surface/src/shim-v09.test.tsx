import type { MessageProcessor } from "@a2ui/web_core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fakeModel, runAgentTurn } from "./agent.js";
import { PROTO_CATALOG_ID, protoCatalog, protoRegistry } from "./catalog.js";
import { createProcessor } from "./processor.js";
import { A2uiSurface } from "./renderer.js";
import { upgradeV09Message } from "./shim-v09.js";

/** The same surface as fakeModel's turn, as a v0.9.1 agent would send it. */
const v091Turn: Record<string, any>[] = [
  { version: "v0.9.1", createSurface: { surfaceId: "confirm-delete", catalogId: "proto-0.9" } },
  {
    version: "v0.9.1",
    updateComponents: {
      surfaceId: "confirm-delete",
      components: [
        { id: "root", component: "Column", children: ["intro", "card"] },
        { id: "intro", component: "Text", variant: "h3", text: "The agent wants to clean up." },
        {
          id: "card",
          component: "ConfirmCard",
          title: "Delete 3 files?",
          body: "a.txt, b.txt and c.txt will be removed from the workspace.",
          confirmLabel: "Delete",
        },
      ],
    },
  },
];

const render = (p: MessageProcessor) => {
  const surface = p.getSurface("confirm-delete");
  if (!surface) throw new Error("no surface");
  return renderToStaticMarkup(<A2uiSurface surface={surface} registry={protoRegistry} />);
};

describe("v0.9.1 → 1.0 upgrade shim", () => {
  it("web_core alone refuses v0.9.1 messages against a 1.0 catalog", () => {
    const p = createProcessor([protoCatalog]);
    const errors = p.processMessagesWithErrors(
      v091Turn.map((m) => ({
        ...m,
        createSurface: m.createSurface && { ...m.createSurface, catalogId: PROTO_CATALOG_ID },
      })),
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it("upgrades the envelope, catalog id and dropped enum values", () => {
    const up = upgradeV09Message(v091Turn[1] as Record<string, unknown>, {
      catalogIds: { "proto-0.9": PROTO_CATALOG_ID },
    });
    expect(up.version).toBe("1.0");
    const intro = (up.updateComponents as { components: Record<string, unknown>[] }).components[1];
    expect(intro).not.toHaveProperty("variant");
    expect(
      upgradeV09Message(v091Turn[0] as Record<string, unknown>, {
        catalogIds: { "proto-0.9": PROTO_CATALOG_ID },
      }).createSurface,
    ).toMatchObject({ catalogId: PROTO_CATALOG_ID });
  });

  it("a v0.9.1 turn renders the same as the 1.0 turn", async () => {
    const p10 = createProcessor([protoCatalog]);
    await runAgentTurn(p10, fakeModel);

    const p09 = createProcessor([protoCatalog]);
    const errors = p09.processMessagesWithErrors(
      v091Turn.map((m) => upgradeV09Message(m, { catalogIds: { "proto-0.9": PROTO_CATALOG_ID } })),
    );
    expect(errors).toEqual([]);
    expect(render(p09)).toBe(render(p10));
  });
});
