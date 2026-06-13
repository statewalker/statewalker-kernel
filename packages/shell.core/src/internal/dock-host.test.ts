import type { DockviewApi, IDockviewPanel } from "dockview-react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DockHost } from "../public/dock-host.js";

interface FakePanel {
  id: string;
  params: Record<string, unknown>;
  focus: ReturnType<typeof vi.fn>;
}

interface FakeDockviewApi {
  addPanel: ReturnType<typeof vi.fn>;
  removePanel: ReturnType<typeof vi.fn>;
  getPanel: ReturnType<typeof vi.fn>;
  readonly panels: IDockviewPanel[];
  toJSON: ReturnType<typeof vi.fn>;
  fromJSON: ReturnType<typeof vi.fn>;
  onDidLayoutChange: ReturnType<typeof vi.fn>;
  onDidActivePanelChange: ReturnType<typeof vi.fn>;
  activePanel: IDockviewPanel | undefined;
}

function makeFakeApi(): {
  api: FakeDockviewApi;
  panels: Map<string, FakePanel>;
  emitLayoutChange: () => void;
} {
  const panels = new Map<string, FakePanel>();
  const layoutListeners = new Set<() => void>();
  const api: FakeDockviewApi = {
    addPanel: vi.fn((opts: { id: string; params?: Record<string, unknown> }) => {
      const panel: FakePanel = {
        id: opts.id,
        params: opts.params ?? {},
        focus: vi.fn(),
      };
      panels.set(opts.id, panel);
      return panel as unknown as IDockviewPanel;
    }),
    removePanel: vi.fn((p: { id: string }) => {
      panels.delete(p.id);
    }),
    getPanel: vi.fn((id: string) => panels.get(id) as unknown as IDockviewPanel | undefined),
    get panels() {
      return Array.from(panels.values()) as unknown as IDockviewPanel[];
    },
    toJSON: vi.fn(() => ({ snapshot: Array.from(panels.keys()) })),
    fromJSON: vi.fn(),
    onDidLayoutChange: vi.fn((cb: () => void) => {
      layoutListeners.add(cb);
      return { dispose: () => layoutListeners.delete(cb) };
    }),
    onDidActivePanelChange: vi.fn(() => ({ dispose: () => {} })),
    activePanel: undefined,
  };
  return {
    api,
    panels,
    emitLayoutChange: () => {
      layoutListeners.forEach((cb) => {
        cb();
      });
    },
  };
}

let storage: Map<string, string>;

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DockHost", () => {
  it("queues showOrFocus before api attach, drains after setApi", async () => {
    const host = new DockHost();
    const promise = host.showOrFocus({ panelId: "p1", specId: "spec:s1" });
    expect(host._pendingCount()).toBe(1);

    const { api, panels } = makeFakeApi();
    host.setApi(api as unknown as DockviewApi);
    await promise;

    expect(host._pendingCount()).toBe(0);
    expect(api.addPanel).toHaveBeenCalledTimes(1);
    expect(panels.get("p1")?.params).toEqual({ specId: "spec:s1" });
  });

  it("dispatches showOrFocus immediately when api is online", async () => {
    const { api, panels } = makeFakeApi();
    const host = new DockHost();
    host.setApi(api as unknown as DockviewApi);

    await host.showOrFocus({ panelId: "p1", specId: "spec:s1" });

    expect(api.addPanel).toHaveBeenCalledTimes(1);
    expect(panels.has("p1")).toBe(true);
  });

  it("focuses an existing panel instead of duplicating", async () => {
    const { api, panels } = makeFakeApi();
    const host = new DockHost();
    host.setApi(api as unknown as DockviewApi);

    await host.showOrFocus({ panelId: "p1", specId: "spec:s1" });
    const firstAddCount = api.addPanel.mock.calls.length;
    await host.showOrFocus({ panelId: "p1", specId: "spec:s1" });

    expect(api.addPanel.mock.calls.length).toBe(firstAddCount);
    expect(panels.get("p1")?.focus).toHaveBeenCalled();
  });

  it("respects activate=false on existing panel", async () => {
    const { api, panels } = makeFakeApi();
    const host = new DockHost();
    host.setApi(api as unknown as DockviewApi);

    await host.showOrFocus({ panelId: "p1", specId: "spec:s1" });
    panels.get("p1")?.focus.mockClear();
    await host.showOrFocus({
      panelId: "p1",
      specId: "spec:s1",
      activate: false,
    });
    expect(panels.get("p1")?.focus).not.toHaveBeenCalled();
  });

  it("closePanel removes the panel via the api", async () => {
    const { api, panels } = makeFakeApi();
    const host = new DockHost();
    host.setApi(api as unknown as DockviewApi);

    await host.showOrFocus({ panelId: "p1", specId: "spec:s1" });
    host.closePanel("p1");
    expect(panels.has("p1")).toBe(false);
  });

  it("closePanel called pre-attach drops the queued entry", () => {
    const host = new DockHost();
    void host.showOrFocus({ panelId: "p1", specId: "spec:s1" });
    void host.showOrFocus({ panelId: "p2", specId: "spec:s2" });
    expect(host._pendingCount()).toBe(2);
    host.closePanel("p1");
    expect(host._pendingCount()).toBe(1);
  });

  it("focusPanel is a no-op when api is missing", () => {
    const host = new DockHost();
    expect(() => host.focusPanel("missing")).not.toThrow();
  });

  it("focusPanel is a no-op when panel does not exist", async () => {
    const { api } = makeFakeApi();
    const host = new DockHost();
    host.setApi(api as unknown as DockviewApi);
    expect(() => host.focusPanel("missing")).not.toThrow();
  });

  it("persists layout to localStorage on layout change", async () => {
    const { api, emitLayoutChange } = makeFakeApi();
    const host = new DockHost();
    host.setApi(api as unknown as DockviewApi);
    await host.showOrFocus({ panelId: "p1", specId: "spec:s1" });
    emitLayoutChange();

    // Save is debounced via queueMicrotask.
    await new Promise<void>((r) => queueMicrotask(r));

    const stored = storage.get("chat-mini:dock-layout");
    expect(stored).toBeDefined();
    expect(JSON.parse(stored ?? "{}").snapshot).toContain("p1");
  });

  it("restores layout from localStorage on first attach", () => {
    storage.set("chat-mini:dock-layout", JSON.stringify({ snapshot: ["p1"] }));
    const { api } = makeFakeApi();
    const host = new DockHost();
    host.setApi(api as unknown as DockviewApi);
    expect(api.fromJSON).toHaveBeenCalledWith({ snapshot: ["p1"] });
  });

  it("detach disposes the layout-change listener", async () => {
    const { api, emitLayoutChange } = makeFakeApi();
    const host = new DockHost();
    host.setApi(api as unknown as DockviewApi);
    host.detach();
    api.toJSON.mockClear();
    emitLayoutChange();
    await new Promise<void>((r) => queueMicrotask(r));
    expect(api.toJSON).not.toHaveBeenCalled();
  });
});
