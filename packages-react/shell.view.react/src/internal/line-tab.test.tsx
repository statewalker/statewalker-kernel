// Phase 1b coverage (task 4.5): Pattern-B behavioral tests for the LineTab
// dock tab header. Mounted under <AppWorkspaceProvider> with a real Workspace
// (real Slots + Commands adapters); only the dockview panel `api` is a fake
// stand-in (a genuine collaborator we don't own) and the ClosePanelCommand
// handler is mocked. The component under test is never mocked.
import { Commands } from "@statewalker/shared-commands";
import { Slots } from "@statewalker/shared-slots";
import { ClosePanelCommand } from "@statewalker/shell.core";
import { AppWorkspaceProvider } from "@statewalker/ui.view.react";
import { Workspace } from "@statewalker/workspace.core";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { IDockviewPanelHeaderProps } from "dockview-react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dockTabIconSlot } from "../public/extension-points.js";
import { LineTab } from "./line-tab.js";

afterEach(cleanup);

// Minimal stand-in for the dockview panel api LineTab reads. title/isActive
// are static here; the subscription methods return a no-op disposable.
/** Header props around a minimal api stand-in (LineTab only reads `api`). */
function headerProps(api: unknown): IDockviewPanelHeaderProps {
  return { api, containerApi: {}, params: {} } as unknown as IDockviewPanelHeaderProps;
}

function fakeApi(over: { id: string; title?: string; isActive?: boolean }) {
  return {
    id: over.id,
    title: over.title,
    isActive: over.isActive ?? false,
    onDidTitleChange: () => ({ dispose() {} }),
    onDidActiveChange: () => ({ dispose() {} }),
  };
}

function mount(ws: Workspace, ui: ReactElement) {
  return render(<AppWorkspaceProvider workspace={ws}>{ui}</AppWorkspaceProvider>);
}

describe("LineTab", () => {
  it("renders the panel title from the api", () => {
    const ws = new Workspace();
    const utils = mount(
      ws,
      <LineTab {...headerProps(fakeApi({ id: "p:1", title: "My Session" }))} />,
    );
    expect(utils.getByText("My Session")).toBeTruthy();
  });

  it("falls back to 'Untitled' when the title is empty", () => {
    const ws = new Workspace();
    const utils = mount(ws, <LineTab {...headerProps(fakeApi({ id: "p:1", title: "" }))} />);
    expect(utils.getByText("Untitled")).toBeTruthy();
  });

  it("dispatches ClosePanelCommand with the panel id when the X is clicked", () => {
    const ws = new Workspace();
    const commands = ws.requireAdapter(Commands);
    const closed = vi.fn();
    commands.listen(ClosePanelCommand, (cmd) => {
      closed(cmd.payload);
      cmd.resolve();
      return true;
    });
    const utils = mount(ws, <LineTab {...headerProps(fakeApi({ id: "chat:42" }))} />);
    fireEvent.click(utils.getByRole("button", { name: /close tab/i }));
    expect(closed).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledWith({ panelId: "chat:42" });
  });

  it("resolves the tab icon by LONGEST matching panel-id prefix", () => {
    // Two contributions overlap on `chat:`; the more specific `chat:agent:`
    // must win for a `chat:agent:*` panel. A shortest-prefix or first-match
    // impl would render icon-broad instead.
    const ws = new Workspace();
    const slots = ws.requireAdapter(Slots);
    slots.provide(dockTabIconSlot, {
      panelIdPrefix: "chat:",
      Icon: () => <svg data-testid="icon-broad" />,
    });
    slots.provide(dockTabIconSlot, {
      panelIdPrefix: "chat:agent:",
      Icon: () => <svg data-testid="icon-specific" />,
    });
    const utils = mount(
      ws,
      <LineTab {...headerProps(fakeApi({ id: "chat:agent:7", title: "A" }))} />,
    );
    expect(utils.queryByTestId("icon-specific")).not.toBeNull();
    expect(utils.queryByTestId("icon-broad")).toBeNull();
  });

  it("renders no icon when no prefix matches the panel id", () => {
    const ws = new Workspace();
    const slots = ws.requireAdapter(Slots);
    slots.provide(dockTabIconSlot, {
      panelIdPrefix: "pdf:",
      Icon: () => <svg data-testid="icon-pdf" />,
    });
    const utils = mount(ws, <LineTab {...headerProps(fakeApi({ id: "chat:1", title: "A" }))} />);
    expect(utils.queryByTestId("icon-pdf")).toBeNull();
  });
});
