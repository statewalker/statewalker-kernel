// @vitest-environment jsdom
// Complex, stateful catalog components: a CodeMirror editor and a Leaflet map.
import { undoDepth } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { A2uiSurface } from "../client/index.js";
import { createActionRouter, createProcessor } from "../src/index.js";
import { createTestBus } from "./fixtures/bus.js";
import {
  PROTO_CATALOG_ID,
  protoCatalog,
  protoComponents,
  protoRegistry,
  SAVE_DOCUMENT,
  SELECT_PLACE,
} from "./fixtures/catalog.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const places = [
  { id: "ber", lat: 52.52, lng: 13.405, label: "Berlin" },
  { id: "par", lat: 48.857, lng: 2.352, label: "Paris" },
];

async function setup(components: Record<string, unknown>[], dataModel: unknown) {
  const commands = createTestBus();
  const saved = vi.fn(async (_p: unknown) => ({ ok: true }));
  const selected = vi.fn(async (_p: unknown) => ({ ok: true }));
  commands.listen(SAVE_DOCUMENT, (payload) => saved(payload));
  commands.listen(SELECT_PLACE, (payload) => selected(payload));
  const policy = vi.fn(() => "allow" as const);
  const router = createActionRouter({
    commands,
    components: protoComponents,
    isAgentSurface: () => true,
    policy,
    approve: async () => false,
  });
  const processor = createProcessor([protoCatalog], router.handle);
  router.attach(processor);
  const errors = processor.processMessagesWithErrors({
    version: "1.0",
    createSurface: { surfaceId: "s", catalogId: PROTO_CATALOG_ID, components, dataModel },
  } as any);
  expect(errors).toEqual([]);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(<A2uiSurface surface={processor.getSurface("s")!} registry={protoRegistry} />),
  );
  const update = (path: string, value: unknown) =>
    act(async () => {
      processor.processMessages({
        version: "1.0",
        updateDataModel: { surfaceId: "s", path, value },
      });
    });
  const surface = processor.getSurface("s")!;
  return { host, root, saved, selected, policy, router, update, surface };
}

describe("CodeEditor (CodeMirror 6)", () => {
  const editorSurface = [
    { id: "root", component: "CodeEditor", value: { "@path": "/doc/text" }, language: "markdown" },
  ];
  const findView = async (host: HTMLElement) => {
    await vi.waitFor(() => expect(host.querySelector(".cm-editor")).not.toBeNull());
    const dom = host.querySelector(".cm-editor") as HTMLElement;
    const view = EditorView.findFromDOM(dom);
    if (!view) throw new Error("no EditorView");
    return { dom, view };
  };

  it("shows the bound document and saves the typed text through the policy", async () => {
    const t = await setup(editorSurface, { doc: { text: "# Hello" } });
    const { view } = await findView(t.host);
    expect(view.state.doc.toString()).toBe("# Hello");
    await act(async () => {
      view.dispatch({ changes: { from: view.state.doc.length, insert: "\nworld" } });
    });
    const save = t.host.querySelector("[data-cm-save]") as HTMLButtonElement;
    await act(async () => save.click());
    await vi.waitFor(() => expect(t.router.log.at(-1)?.outcome).toBe("ran"));
    expect(t.policy).toHaveBeenCalledWith(
      expect.objectContaining({ command: SAVE_DOCUMENT, event: "save" }),
    );
    expect(t.saved).toHaveBeenCalledWith({ value: "# Hello\nworld" });
    t.root.unmount();
  });

  it("an agent update equal to the editor content neither remounts nor resets undo", async () => {
    const t = await setup(editorSurface, { doc: { text: "# Hello" } });
    const { dom, view } = await findView(t.host);
    await act(async () => {
      view.dispatch({ changes: { from: 7, insert: "!" }, userEvent: "input.type" });
    });
    expect(undoDepth(view.state)).toBe(1);
    await t.update("/doc/text", "# Hello!");
    expect(t.host.querySelector(".cm-editor")).toBe(dom);
    expect(EditorView.findFromDOM(dom)).toBe(view);
    expect(undoDepth(view.state)).toBe(1);
    t.root.unmount();
  });

  it("a different agent value is applied in place as a minimal change (undo kept)", async () => {
    const t = await setup(editorSurface, { doc: { text: "# Hello\n\nbody" } });
    const { dom, view } = await findView(t.host);
    await act(async () => {
      view.dispatch({ changes: { from: 7, insert: "!" }, userEvent: "input.type" });
    });
    // The agent edits a different part of the document.
    await t.update("/doc/text", "# Hello!\n\nbody, appended by the agent");
    expect(t.host.querySelector(".cm-editor")).toBe(dom);
    expect(view.state.doc.toString()).toBe("# Hello!\n\nbody, appended by the agent");
    expect(undoDepth(view.state)).toBe(1);
    // Undo reverts the user's own edit only, not the agent's.
    const { undo } = await import("@codemirror/commands");
    await act(async () => void undo(view));
    expect(view.state.doc.toString()).toBe("# Hello\n\nbody, appended by the agent");
    t.root.unmount();
  });

  it("user edits are written back to the bound path (two-way), so agent pushes keep them", async () => {
    const t = await setup(editorSurface, { doc: { text: "# Hello" } });
    const { dom, view } = await findView(t.host);
    await act(async () => {
      view.dispatch({ changes: { from: 7, insert: "!" }, userEvent: "input.type" });
    });
    await vi.waitFor(() => expect(t.surface.dataModel.get("/doc/text")).toBe("# Hello!"));
    // An agent that builds its push from the data model now sees the user's edit.
    await t.update("/doc/text", `${t.surface.dataModel.get("/doc/text")}\nmore`);
    expect(view.state.doc.toString()).toBe("# Hello!\nmore");
    expect(t.host.querySelector(".cm-editor")).toBe(dom);
    expect(undoDepth(view.state)).toBe(1);
    t.root.unmount();
  });

  it("destroys the EditorView when the surface unmounts", async () => {
    const t = await setup(editorSurface, { doc: { text: "x" } });
    const { view } = await findView(t.host);
    const destroy = vi.spyOn(view, "destroy");
    t.root.unmount();
    expect(destroy).toHaveBeenCalled();
  });
});

describe("MapView (Leaflet)", () => {
  const mapSurface = [
    {
      id: "root",
      component: "MapView",
      center: [50.5, 8],
      zoom: 5,
      markers: { "@path": "/places" },
    },
  ];
  const markerEls = (host: HTMLElement) =>
    [...host.querySelectorAll("[data-marker-id]")] as HTMLElement[];

  it("renders bound markers as DOM elements; a click selects through the policy", async () => {
    const t = await setup(mapSurface, { places });
    await vi.waitFor(() => expect(markerEls(t.host)).toHaveLength(2));
    expect(markerEls(t.host).map((m) => m.textContent)).toEqual(["Berlin", "Paris"]);
    const paris = t.host.querySelector('[data-marker-id="par"]') as HTMLElement;
    await act(async () => paris.click());
    await vi.waitFor(() => expect(t.router.log.at(-1)?.outcome).toBe("ran"));
    expect(t.policy).toHaveBeenCalledWith(
      expect.objectContaining({ command: SELECT_PLACE, event: "select" }),
    );
    expect(t.selected).toHaveBeenCalledWith({ id: "par" });
    t.root.unmount();
  });

  it("follows a markers update from the agent without recreating the map", async () => {
    const t = await setup(mapSurface, { places });
    await vi.waitFor(() => expect(markerEls(t.host)).toHaveLength(2));
    const container = t.host.querySelector(".leaflet-container");
    const berlin = t.host.querySelector('[data-marker-id="ber"]');
    await t.update("/places", [places[0], { id: "rom", lat: 41.9, lng: 12.5, label: "Rome" }]);
    expect(markerEls(t.host).map((m) => m.dataset.markerId)).toEqual(["ber", "rom"]);
    expect(t.host.querySelector(".leaflet-container")).toBe(container);
    expect(t.host.querySelector('[data-marker-id="ber"]')).toBe(berlin); // kept, not rebuilt
    t.root.unmount();
  });
});
