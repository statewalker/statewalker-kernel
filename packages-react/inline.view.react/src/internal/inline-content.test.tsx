import { type InlineComponentDescriptor, inlineComponentSlot } from "@statewalker/inline.core";
import { VisualizeFileCommand } from "@statewalker/mime.core";
import { Command, Commands, passthrough } from "@statewalker/shared-commands";
import { Slots } from "@statewalker/shared-slots";
import { AppWorkspaceProvider } from "@statewalker/ui.view.react";
import { LoadDirectoryCommand, Workspace } from "@statewalker/workspace.core";
import { fireEvent, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import initInlineContentReact from "../public/init.js";
import { InlineContent } from "../public/inline-content.js";
import { inlineContentRenderersSlot } from "../public/inline-content-registry.js";

function mount(ws: Workspace, ui: ReactElement) {
  return render(<AppWorkspaceProvider workspace={ws}>{ui}</AppWorkspaceProvider>);
}

describe("inline-content-views built-ins", () => {
  it("registers all five built-ins under stable ids", async () => {
    const ws = new Workspace();
    const ctx: Record<string, unknown> = { "workspace:workspace": ws };
    const cleanup = initInlineContentReact(ctx);

    const slots = ws.requireAdapter(Slots);
    expect(slots.get(inlineContentRenderersSlot, "metric-card")).not.toBeNull();
    expect(slots.get(inlineContentRenderersSlot, "line-chart")).not.toBeNull();
    expect(slots.get(inlineContentRenderersSlot, "file-card")).not.toBeNull();
    expect(slots.get(inlineContentRenderersSlot, "directory-card")).not.toBeNull();
    expect(slots.get(inlineContentRenderersSlot, "action-button")).not.toBeNull();

    await cleanup();
    expect(slots.get(inlineContentRenderersSlot, "metric-card")).toBeNull();
  });

  it("contributes descriptors to inline-content:components", async () => {
    const ws = new Workspace();
    const slots = ws.requireAdapter(Slots);
    const ctx: Record<string, unknown> = { "workspace:workspace": ws };
    const cleanup = initInlineContentReact(ctx);

    let descriptors: readonly InlineComponentDescriptor[] = [];
    const dispose = slots.observe(inlineComponentSlot, (vs) => {
      descriptors = vs;
    });
    expect(descriptors.map((d) => d.id).sort()).toEqual([
      "action-button",
      "directory-card",
      "file-card",
      "line-chart",
      "metric-card",
    ]);
    dispose();
    await cleanup();
  });

  it("renders MetricCard via InlineContent", async () => {
    const ws = new Workspace();
    const ctx: Record<string, unknown> = { "workspace:workspace": ws };
    const cleanup = initInlineContentReact(ctx);

    const utils = mount(
      ws,
      <InlineContent
        spec={{
          componentId: "metric-card",
          props: {
            label: "Revenue",
            value: "$12.4k",
            delta: "+4.2%",
            trend: "positive",
          },
        }}
      />,
    );
    expect(utils.getByText("Revenue")).toBeTruthy();
    expect(utils.getByText("$12.4k")).toBeTruthy();
    expect(utils.getByText("+4.2%")).toBeTruthy();

    utils.unmount();
    await cleanup();
  });

  it("renders LineChart via InlineContent", async () => {
    const ws = new Workspace();
    const ctx: Record<string, unknown> = { "workspace:workspace": ws };
    const cleanup = initInlineContentReact(ctx);

    const utils = mount(
      ws,
      <InlineContent
        spec={{
          componentId: "line-chart",
          props: {
            values: [1, 3, 2, 5, 4],
            startLabel: "Mon",
            endLabel: "Fri",
          },
        }}
      />,
    );
    // SVG polyline element exists
    expect(utils.container.querySelector("polyline")).toBeTruthy();
    expect(utils.getByText("Mon")).toBeTruthy();
    expect(utils.getByText("Fri")).toBeTruthy();

    utils.unmount();
    await cleanup();
  });

  it("falls back to an inline error chip for unknown component ids", async () => {
    const ws = new Workspace();
    const ctx: Record<string, unknown> = { "workspace:workspace": ws };
    const cleanup = initInlineContentReact(ctx);

    const utils = mount(ws, <InlineContent spec={{ componentId: "no-such-thing", props: {} }} />);
    expect(utils.getByText(/Unknown inline component/i)).toBeTruthy();

    utils.unmount();
    await cleanup();
  });

  it("DirectoryCard renders explicit entries without firing runLoadDirectory", async () => {
    const ws = new Workspace();
    const ctx: Record<string, unknown> = { "workspace:workspace": ws };
    const cleanup = initInlineContentReact(ctx);
    const commands = ws.requireAdapter(Commands);

    const loadDir = vi.fn();
    const disposeLoad = commands.listen(LoadDirectoryCommand, (command) => {
      loadDir(command.payload);
      command.resolve([]);
      return true;
    });

    const utils = mount(
      ws,
      <InlineContent
        spec={{
          componentId: "directory-card",
          props: {
            uri: "file:///docs",
            name: "docs",
            entries: [
              { name: "a.md", kind: "file" },
              { name: "sub", kind: "directory" },
            ],
          },
        }}
      />,
    );

    expect(utils.getByText("docs")).toBeTruthy();
    expect(utils.getByText("a.md")).toBeTruthy();
    expect(utils.getByText("sub/")).toBeTruthy();
    expect(loadDir).not.toHaveBeenCalled();

    utils.unmount();
    disposeLoad();
    await cleanup();
  });

  it("DirectoryCard lazy-loads entries via runLoadDirectory when entries are omitted", async () => {
    const ws = new Workspace();
    const ctx: Record<string, unknown> = { "workspace:workspace": ws };
    const cleanup = initInlineContentReact(ctx);
    const commands = ws.requireAdapter(Commands);

    const loadDir = vi.fn();
    const disposeLoad = commands.listen(LoadDirectoryCommand, (command) => {
      loadDir(command.payload);
      command.resolve([
        { name: "a.md", path: "/docs/a.md", kind: "file", size: 0, lastModified: 0 },
        { name: "sub", path: "/docs/sub", kind: "directory" },
      ]);
      return true;
    });

    const utils = mount(
      ws,
      <InlineContent
        spec={{
          componentId: "directory-card",
          props: { uri: "file:///docs" },
        }}
      />,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(loadDir).toHaveBeenCalledTimes(1);
    expect(loadDir).toHaveBeenCalledWith({ path: "/docs", recursive: false });
    expect(utils.getByText("a.md")).toBeTruthy();
    expect(utils.getByText("sub/")).toBeTruthy();

    utils.unmount();
    disposeLoad();
    await cleanup();
  });

  it("DirectoryCard fires runVisualizeFile when an entry is clicked", async () => {
    const ws = new Workspace();
    const ctx: Record<string, unknown> = { "workspace:workspace": ws };
    const cleanup = initInlineContentReact(ctx);
    const commands = ws.requireAdapter(Commands);

    const visualize = vi.fn();
    const disposeVisualize = commands.listen(VisualizeFileCommand, (command) => {
      visualize(command.payload);
      command.resolve();
      return true;
    });

    const utils = mount(
      ws,
      <InlineContent
        spec={{
          componentId: "directory-card",
          props: {
            uri: "file:///docs",
            entries: [
              { name: "a.md", kind: "file" },
              { name: "sub", kind: "directory" },
            ],
          },
        }}
      />,
    );

    fireEvent.click(utils.getByText("a.md"));
    fireEvent.click(utils.getByText("sub/"));

    expect(visualize).toHaveBeenCalledTimes(2);
    expect(visualize).toHaveBeenNthCalledWith(1, { uri: "file:///docs/a.md" });
    expect(visualize).toHaveBeenNthCalledWith(2, { uri: "file:///docs/sub" });

    utils.unmount();
    disposeVisualize();
    await cleanup();
  });

  it("ActionButton dispatches its configured command with the payload on click", async () => {
    const ws = new Workspace();
    const ctx: Record<string, unknown> = { "workspace:workspace": ws };
    const cleanup = initInlineContentReact(ctx);
    const commands = ws.requireAdapter(Commands);

    // A listener registered under the same key the button fires receives
    // the dispatch — the button synthesizes a matching silent declaration.
    const TestActionCommand = Command.silent("inline:test-action")
      .input(passthrough<unknown>())
      .output(passthrough<void>())
      .build();
    const handler = vi.fn();
    const disposeHandler = commands.listen(TestActionCommand, (command) => {
      handler(command.payload);
      command.resolve();
      return true;
    });

    const utils = mount(
      ws,
      <InlineContent
        spec={{
          componentId: "action-button",
          props: {
            label: "Do it",
            command: "inline:test-action",
            payload: { hello: "world" },
          },
        }}
      />,
    );

    fireEvent.click(utils.getByText("Do it"));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ hello: "world" });

    utils.unmount();
    disposeHandler();
    await cleanup();
  });

  it("plug-in: a custom component registered later renders alongside built-ins", async () => {
    const ws = new Workspace();
    const ctx: Record<string, unknown> = { "workspace:workspace": ws };
    const cleanupBuiltins = initInlineContentReact(ctx);

    // Plug-in path: register a custom component into the same
    // registry. Renders via InlineContent without any built-in
    // glue knowing about it.
    const slots = ws.requireAdapter(Slots);
    const disposeCustom = slots.register(
      inlineContentRenderersSlot,
      "plugin:badge",
      ({ props }) => <span data-testid="plugin-badge">{(props as { text: string }).text}</span>,
    );

    const utils = mount(
      ws,
      <InlineContent spec={{ componentId: "plugin:badge", props: { text: "BETA" } }} />,
    );
    expect(utils.getByTestId("plugin-badge").textContent).toBe("BETA");

    utils.unmount();
    disposeCustom();
    await cleanupBuiltins();
  });
});
