import { ShowDockPanelCommand } from "@statewalker/dock";
import { Commands } from "@statewalker/shared-commands";
import { Slots } from "@statewalker/shared-slots";
import { SpecStore } from "@statewalker/spec-store";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { Workspace } from "@statewalker/workspace";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mimeRenderersSlot, VisualizeFileCommand } from "../index.js";
import { FilesManager, guessMimeType, pickRenderer } from "./files.manager.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("pickRenderer", () => {
  const buildPanel = () => ({
    catalogId: "x",
    spec: {},
    panelId: "x",
    specId: "x",
  });

  it("returns the lowest-order match for a literal mime type", () => {
    const renderers = [
      { mimeTypePattern: "text/markdown", buildPanel, order: 100 },
      { mimeTypePattern: "text/markdown", buildPanel, order: 10 },
    ];
    expect(pickRenderer(renderers, "text/markdown")?.order).toBe(10);
  });

  it("matches glob patterns", () => {
    const renderers = [
      { mimeTypePattern: "image/*", buildPanel },
      { mimeTypePattern: "text/*", buildPanel, order: 50 },
    ];
    expect(pickRenderer(renderers, "image/png")?.mimeTypePattern).toBe("image/*");
    expect(pickRenderer(renderers, "text/markdown")?.mimeTypePattern).toBe("text/*");
  });

  it("returns undefined when nothing matches", () => {
    expect(pickRenderer([], "text/plain")).toBeUndefined();
  });

  it("guessMimeType maps common video extensions to video/*", () => {
    expect(guessMimeType("/x/y.mp4").startsWith("video/")).toBe(true);
    expect(guessMimeType("/x/y.webm").startsWith("video/")).toBe(true);
    expect(guessMimeType("/x/y.ogg").startsWith("video/")).toBe(true);
    expect(guessMimeType("/x/y.mov").startsWith("video/")).toBe(true);
  });

  it("pickRenderer resolves the video/* contribution for .mp4 and .webm", () => {
    const renderers = [
      { mimeTypePattern: "video/*", buildPanel },
      { mimeTypePattern: "image/*", buildPanel },
    ];
    expect(pickRenderer(renderers, guessMimeType("/x/y.mp4"))?.mimeTypePattern).toBe("video/*");
    expect(pickRenderer(renderers, guessMimeType("/x/y.webm"))?.mimeTypePattern).toBe("video/*");
  });
});

describe("runVisualizeFile", () => {
  it("rejects when no mime-renderer is registered for the URI", async () => {
    const files = new MemFilesApi();
    const ws = new Workspace();
    ws.setFileSystem(files, "test");
    const manager = new FilesManager({ workspace: ws });
    await ws.open();
    const commands = ws.requireAdapter(Commands);

    await expect(commands.call(VisualizeFileCommand, { uri: "/note.md" }).promise).rejects.toThrow(
      /mime-renderer/,
    );

    await manager.close();
  });

  it("creates a spec, opens a dock panel, and is idempotent on reopen", async () => {
    const files = new MemFilesApi();
    const ws = new Workspace();
    ws.setFileSystem(files, "test");
    const manager = new FilesManager({ workspace: ws });
    const slots = ws.requireAdapter(Slots);
    const store = ws.requireAdapter(SpecStore);
    const commands = ws.requireAdapter(Commands);

    // Stand-in dock handler — replaces the dock fragment in this
    // unit test. Captures show-panel calls for assertion.
    const shows: Array<{ panelId: string; specId: string }> = [];
    const disposeDock = commands.listen(ShowDockPanelCommand, (command) => {
      shows.push({
        panelId: command.payload.panelId,
        specId: command.payload.specId,
      });
      command.resolve();
      return true;
    });

    await ws.open();

    slots.provide(mimeRenderersSlot, {
      mimeTypePattern: "text/markdown",
      buildPanel: (uri) => ({
        catalogId: "markdown-viewer",
        spec: {
          root: "panel",
          elements: {
            panel: { type: "MarkdownView", props: { uri }, children: [] },
          },
        },
        panelId: `markdown-viewer:${uri}`,
        specId: `spec:markdown-viewer:${uri}`,
      }),
    });

    await commands.call(VisualizeFileCommand, { uri: "/note.md" }).promise;
    expect(shows).toEqual([
      {
        panelId: "markdown-viewer:/note.md",
        specId: "spec:markdown-viewer:/note.md",
      },
    ]);
    expect(store.get("spec:markdown-viewer:/note.md")).not.toBeNull();
    expect(store.get("spec:markdown-viewer:/note.md")?.catalogId).toBe("markdown-viewer");

    // Reopen: same spec id, no duplicate create — dock is asked
    // again (it focuses internally), but SpecStore.create is NOT
    // called twice.
    await commands.call(VisualizeFileCommand, { uri: "/note.md" }).promise;
    expect(shows).toHaveLength(2);

    disposeDock();
    await manager.close();
  });
});
