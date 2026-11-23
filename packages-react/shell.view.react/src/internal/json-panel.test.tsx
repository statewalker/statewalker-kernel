// Phase 1b coverage (task 4.5): Pattern-B behavioral tests for JsonPanel, the
// single dockview component kind. Real Workspace with real SpecStore + Slots +
// Commands adapters and a real @json-render registry; only the dockview panel
// `props` (api/params) is a stand-in and ClosePanelCommand is mocked. JsonPanel
// resolves spec-by-id and catalog-by-id, and renders the recovery placeholders
// or the SpecRenderer accordingly.
import { defineCatalog } from "@json-render/core";
import { catalogsSlot, SpecStore } from "@statewalker/render.core";
import { defineRegistry, schema } from "@statewalker/render.view.react";
import { Commands } from "@statewalker/shared-commands";
import { Slots } from "@statewalker/shared-slots";
import { ClosePanelCommand } from "@statewalker/shell.core";
import { AppWorkspaceProvider } from "@statewalker/ui.view.react";
import { Workspace } from "@statewalker/workspace.core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonPanel } from "./json-panel.js";

afterEach(cleanup);

function buildTextRegistry() {
  const catalog = defineCatalog(schema, {
    components: { Text: { props: {}, slots: [], description: "renders text" } },
  } as never);
  const { registry } = defineRegistry(catalog, {
    components: {
      Text: ({ props }: { props: { text?: string } }) => <span>{props.text}</span>,
    },
  } as never);
  return registry;
}

// Minimal stand-in for IDockviewPanelProps: JsonPanel only reads params.specId
// and api.id.
function fakeProps(specId: string, panelId = "panel:1") {
  return { params: { specId }, api: { id: panelId } };
}

function mount(ws: Workspace, ui: ReactElement) {
  return render(<AppWorkspaceProvider workspace={ws}>{ui}</AppWorkspaceProvider>);
}

describe("JsonPanel", () => {
  it("shows the spec-missing placeholder for an unknown spec id", () => {
    const ws = new Workspace();
    const commands = ws.requireAdapter(Commands);
    const closed = vi.fn();
    commands.listen(ClosePanelCommand, (cmd) => {
      closed(cmd.payload);
      cmd.resolve();
      return true;
    });
    const utils = mount(
      ws,
      // biome-ignore lint/suspicious/noExplicitAny: minimal props stand-in
      <JsonPanel {...(fakeProps("ghost", "panel:9") as any)} />,
    );
    expect(utils.getByText(/is missing/i)).toBeTruthy();
    expect(utils.getByText("ghost")).toBeTruthy();
    fireEvent.click(utils.getByRole("button", { name: /close panel/i }));
    expect(closed).toHaveBeenCalledWith({ panelId: "panel:9" });
  });

  it("shows the catalog-missing placeholder when the spec's catalog is unregistered", () => {
    const ws = new Workspace();
    const store = ws.requireAdapter(SpecStore);
    store.create({
      id: "s1",
      catalogId: "no-such-catalog",
      spec: { root: "t", elements: {} },
    });
    // biome-ignore lint/suspicious/noExplicitAny: minimal props stand-in
    const utils = mount(ws, <JsonPanel {...(fakeProps("s1") as any)} />);
    expect(utils.getByText(/is not registered/i)).toBeTruthy();
    expect(utils.getByText("no-such-catalog")).toBeTruthy();
  });

  it("renders the spec via SpecRenderer when both spec and catalog resolve", () => {
    const ws = new Workspace();
    const store = ws.requireAdapter(SpecStore);
    const slots = ws.requireAdapter(Slots);
    slots.register(catalogsSlot, "text-cat", buildTextRegistry());
    store.create({
      id: "s2",
      catalogId: "text-cat",
      spec: {
        root: "t",
        elements: { t: { type: "Text", props: { text: "PANEL-BODY" } } },
      },
    });
    // biome-ignore lint/suspicious/noExplicitAny: minimal props stand-in
    const utils = mount(ws, <JsonPanel {...(fakeProps("s2") as any)} />);
    expect(utils.getByText("PANEL-BODY")).toBeTruthy();
    // Not the recovery placeholders.
    expect(utils.queryByText(/is missing/i)).toBeNull();
    expect(utils.queryByText(/is not registered/i)).toBeNull();
  });
});
