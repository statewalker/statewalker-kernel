// Phase 1b coverage (task 4.5): MainShell composes three dock slots. Its
// cheaply-testable logic — left/right side-panel PARTITION, compareByOrderAndId
// ORDERING within a side, and the PanelChunk/OverlayMount null-guard on an
// UNREGISTERED viewKey — is asserted behaviorally by mounting the REAL MainShell
// under <AppWorkspaceProvider> and observing the rendered DOM. Only the
// irreducible full-compose (dockview + react-resizable-panels together) is a
// LABELED smoke ("renders without throwing"); everything else is real.
//
// jsdom lacks ResizeObserver, which react-resizable-panels + dockview both
// require at mount. A minimal stub is installed so MainShell renders at all —
// this is test-env setup, not mocking the component under test.
import { Slots } from "@statewalker/shared-slots";
import { dockHeaderItemsSlot, dockOverlaysSlot, dockSidePanelsSlot } from "@statewalker/shell.core";
import {
  AppWorkspaceProvider,
  coreViewsSlot,
  type ViewComponent,
} from "@statewalker/ui.view.react";
import { Workspace } from "@statewalker/workspace.core";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { MainShell } from "./main-shell.js";

beforeAll(() => {
  class RO {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= RO;
});

afterEach(cleanup);

function view(text: string): ViewComponent {
  return (() => <div>{text}</div>) as unknown as ViewComponent;
}

function mount(ws: Workspace) {
  return render(
    <AppWorkspaceProvider workspace={ws}>
      <MainShell />
    </AppWorkspaceProvider>,
  );
}

describe("MainShell side-panel partition", () => {
  it("renders all left-side panels before all right-side panels regardless of order value", () => {
    // Left panel carries a HIGHER order than the right panel. If MainShell
    // sorted one flat list ignoring side, RIGHT (order 1) would precede LEFT
    // (order 5). Partition-by-side means the whole left group precedes the
    // whole right group — so LEFT must appear first in the DOM.
    const ws = new Workspace();
    const slots = ws.requireAdapter(Slots);
    slots.register(coreViewsSlot, "v-left", view("LEFTPANEL"));
    slots.register(coreViewsSlot, "v-right", view("RIGHTPANEL"));
    slots.provide(dockSidePanelsSlot, {
      id: "l",
      side: "left",
      order: 5,
      viewKey: "v-left",
    });
    slots.provide(dockSidePanelsSlot, {
      id: "r",
      side: "right",
      order: 1,
      viewKey: "v-right",
    });
    const { container } = mount(ws);
    const text = container.textContent ?? "";
    expect(text).toContain("LEFTPANEL");
    expect(text).toContain("RIGHTPANEL");
    expect(text.indexOf("LEFTPANEL")).toBeLessThan(text.indexOf("RIGHTPANEL"));
  });
});

describe("MainShell panel ordering within a side", () => {
  it("sorts panels on the same side by compareByOrderAndId (order ascending)", () => {
    // Insertion order is B(order 2) then A(order 1). A sorted render puts A
    // first; an unsorted render would keep B first.
    const ws = new Workspace();
    const slots = ws.requireAdapter(Slots);
    slots.register(coreViewsSlot, "v-a", view("PANEL-A"));
    slots.register(coreViewsSlot, "v-b", view("PANEL-B"));
    slots.provide(dockSidePanelsSlot, {
      id: "b",
      side: "left",
      order: 2,
      viewKey: "v-b",
    });
    slots.provide(dockSidePanelsSlot, {
      id: "a",
      side: "left",
      order: 1,
      viewKey: "v-a",
    });
    const { container } = mount(ws);
    const text = container.textContent ?? "";
    expect(text.indexOf("PANEL-A")).toBeLessThan(text.indexOf("PANEL-B"));
  });
});

describe("MainShell null-guard on unregistered viewKey", () => {
  it("PanelChunk renders nothing (no throw) for a side panel whose viewKey is unregistered", () => {
    // The registered sibling renders; the unregistered viewKey resolves to
    // undefined and PanelChunk must return null. Without the guard, rendering
    // <undefined /> would throw and this mount would fail.
    const ws = new Workspace();
    const slots = ws.requireAdapter(Slots);
    slots.register(coreViewsSlot, "v-ok", view("REGISTERED-PANEL"));
    slots.provide(dockSidePanelsSlot, {
      id: "ok",
      side: "left",
      order: 0,
      viewKey: "v-ok",
    });
    slots.provide(dockSidePanelsSlot, {
      id: "gone",
      side: "left",
      order: 1,
      viewKey: "missing-key",
    });
    const { container } = mount(ws);
    expect(container.textContent).toContain("REGISTERED-PANEL");
  });

  it("OverlayMount renders the registered overlay and nothing for an unregistered viewKey", () => {
    const ws = new Workspace();
    const slots = ws.requireAdapter(Slots);
    slots.register(coreViewsSlot, "v-ov", view("OVERLAY-SHOWN"));
    slots.provide(dockOverlaysSlot, { id: "o1", viewKey: "v-ov" });
    slots.provide(dockOverlaysSlot, {
      id: "o2",
      viewKey: "unregistered-overlay",
    });
    const { container } = mount(ws);
    expect(container.textContent).toContain("OVERLAY-SHOWN");
    // The unregistered overlay contributed no node (OverlayMount returned null).
    expect(container.textContent).not.toContain("unregistered-overlay");
  });
});

describe("MainShell full-compose", () => {
  // smoke: header items + left/right side panels + an overlay + the dockview
  // host all mounted together. The dockview + resizable composition is the
  // irreducible infra with no own logic to assert, so this only proves the
  // full tree renders without throwing.
  it("renders the whole shell under a fully-populated context without throwing", () => {
    const ws = new Workspace();
    const slots = ws.requireAdapter(Slots);
    slots.register(coreViewsSlot, "hdr", view("HEADER-ITEM"));
    slots.register(coreViewsSlot, "side", view("SIDE"));
    slots.register(coreViewsSlot, "ov", view("OV"));
    slots.provide(dockHeaderItemsSlot, {
      id: "h",
      slot: "leading",
      order: 0,
      viewKey: "hdr",
    });
    slots.provide(dockSidePanelsSlot, {
      id: "s",
      side: "left",
      order: 0,
      viewKey: "side",
    });
    slots.provide(dockOverlaysSlot, { id: "o", viewKey: "ov" });
    const { container } = mount(ws);
    expect(container.textContent).toContain("HEADER-ITEM");
    expect(container.textContent).toContain("SIDE");
    expect(container.textContent).toContain("OV");
  });
});
