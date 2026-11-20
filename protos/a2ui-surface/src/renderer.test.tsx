import { MessageProcessor, RELAXED_VALIDATION } from "@a2ui/web_core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fakeModel, runAgentTurn } from "./agent.js";
import { PROTO_CATALOG_ID, protoCatalog, protoRegistry } from "./catalog.js";
import { buildCatalog } from "./define-component.js";
import { A2uiSurface } from "./renderer.js";

function surfaceFrom(components: Record<string, unknown>[]) {
  const processor = new MessageProcessor([protoCatalog], undefined, {
    validationConfig: RELAXED_VALIDATION,
  });
  processor.processMessages({
    version: "1.0",
    createSurface: { surfaceId: "s", catalogId: PROTO_CATALOG_ID, components },
  });
  const surface = processor.getSurface("s");
  if (!surface) throw new Error("no surface");
  return surface;
}

const html = (surface: ReturnType<typeof surfaceFrom>) =>
  renderToStaticMarkup(<A2uiSurface surface={surface} registry={protoRegistry} />);

describe("A2uiSurface renderer", () => {
  it("renders the agent surface from catalog components only", async () => {
    const processor = new MessageProcessor([protoCatalog]);
    await runAgentTurn(processor, fakeModel);
    const surface = processor.getSurface("confirm-delete");
    if (!surface) throw new Error("no surface");
    const out = renderToStaticMarkup(<A2uiSurface surface={surface} registry={protoRegistry} />);
    expect(out).toContain("Delete 3 files?");
    expect(out).toContain('data-a2ui="ConfirmCard"');
    expect(out).toContain('data-a2ui="Text"');
    expect(out).toContain('data-a2ui="Column"');
    expect(out).toContain("<button");
  });

  it("renders a refusal placeholder for an unknown component, not the component", () => {
    const out = html(
      surfaceFrom([
        { id: "root", component: "Column", children: ["x"] },
        { id: "x", component: "EvilWidget", onload: "alert(1)", html: "<b>pwn</b>" },
      ]),
    );
    expect(out).toContain('data-a2ui-refused="EvilWidget"');
    expect(out).not.toContain("<b>pwn</b>");
    expect(out).not.toContain("alert(1)");
  });

  it("refuses a catalog component that has no registered React implementation", () => {
    // Slider is in web_core's basic catalog but not in our registry.
    const processor = new MessageProcessor([
      buildCatalog({ catalogId: "c2", basic: ["Column", "Slider"], components: [] }),
    ]);
    processor.processMessages({
      version: "1.0",
      createSurface: {
        surfaceId: "s",
        catalogId: "c2",
        components: [
          { id: "root", component: "Column", children: ["sl"] },
          { id: "sl", component: "Slider", max: 10, value: 3 },
        ],
      },
    });
    const surface = processor.getSurface("s");
    if (!surface) throw new Error("no surface");
    const out = renderToStaticMarkup(<A2uiSurface surface={surface} registry={protoRegistry} />);
    expect(out).toContain('data-a2ui-refused="Slider"');
  });

  it("renders raw HTML and script in props as text", () => {
    const out = html(
      surfaceFrom([
        { id: "root", component: "Column", children: ["t", "c"] },
        { id: "t", component: "Text", text: "<script>alert(1)</script>" },
        {
          id: "c",
          component: "ConfirmCard",
          title: "<img src=x onerror=alert(2)>",
          body: "<b>bold</b>",
          confirmLabel: "OK",
        },
      ]),
    );
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("the processor rejects an extra dangerouslySetInnerHTML prop on a strict component", () => {
    const processor = new MessageProcessor([protoCatalog]);
    const errors = processor.processMessagesWithErrors({
      version: "1.0",
      createSurface: {
        surfaceId: "s",
        catalogId: PROTO_CATALOG_ID,
        components: [
          {
            id: "root",
            component: "ConfirmCard",
            title: "t",
            body: "b",
            confirmLabel: "ok",
            dangerouslySetInnerHTML: { __html: "<script>alert(1)</script>" },
          },
        ],
      },
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});
