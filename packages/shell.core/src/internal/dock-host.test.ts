import { LayoutStore, restorePanelSpecsFromLayout, SpecStore } from "@statewalker/render.core";
import { writeText } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { initWorkspace, SystemFiles, Workspace } from "@statewalker/workspace.core";
import type { DockviewApi, IDockviewPanel } from "dockview-react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
      const panel: FakePanel = { id: opts.id, params: opts.params ?? {}, focus: vi.fn() };
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
    toJSON: vi.fn(() => ({ panels: Object.fromEntries([...panels.keys()].map((k) => [k, {}])) })),
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

function makeWorkspace(): Workspace {
  return initWorkspace({ workspace: new Workspace(), filesApi: new MemFilesApi() });
}

const flushMicrotask = () => new Promise<void>((r) => queueMicrotask(r));
const flushMacrotask = () => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DockHost — panel queue/focus mechanics (no workspace)", () => {
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
    await host.showOrFocus({ panelId: "p1", specId: "spec:s1", activate: false });
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

  it("focusPanel is a no-op when panel does not exist", () => {
    const { api } = makeFakeApi();
    const host = new DockHost();
    host.setApi(api as unknown as DockviewApi);
    expect(() => host.focusPanel("missing")).not.toThrow();
  });

  it("detach disposes the layout-change listener", async () => {
    const { api, emitLayoutChange } = makeFakeApi();
    const host = new DockHost();
    host.setApi(api as unknown as DockviewApi);
    host.detach();
    api.toJSON.mockClear();
    emitLayoutChange();
    await flushMicrotask();
    expect(api.toJSON).not.toHaveBeenCalled();
  });
});

describe("DockHost — layout persistence via the LayoutStore adapter", () => {
  it("persists the layout through LayoutStore.set on layout change (no localStorage)", async () => {
    const setItem = vi.fn();
    vi.stubGlobal("localStorage", { getItem: () => null, setItem, removeItem: vi.fn() });
    const workspace = makeWorkspace();
    const store = workspace.requireAdapter(LayoutStore);
    const host = new DockHost(workspace);
    const { api, emitLayoutChange } = makeFakeApi();
    host.setApi(api as unknown as DockviewApi);
    await host.showOrFocus({ panelId: "p1", specId: "spec:s1" });
    emitLayoutChange();
    await flushMicrotask();

    expect(store.get()).toEqual({ panels: { p1: {} } });
    expect(setItem).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("restores from LayoutStore.get() when the api attaches after the layout is loaded", () => {
    const workspace = makeWorkspace();
    const store = workspace.requireAdapter(LayoutStore);
    store.set({ panels: { p1: {} } }); // simulate a layout already loaded by connect()
    const host = new DockHost(workspace);
    const { api } = makeFakeApi();
    host.setApi(api as unknown as DockviewApi);
    expect(api.fromJSON).toHaveBeenCalledWith({ panels: { p1: {} } });
  });

  it("cold mount before connect renders the DEFAULT layout (no fromJSON, no I/O)", () => {
    const workspace = makeWorkspace();
    workspace.requireAdapter(LayoutStore); // present but never loaded/set → get() is null
    const host = new DockHost(workspace);
    const { api } = makeFakeApi();
    host.setApi(api as unknown as DockviewApi);
    expect(api.fromJSON).not.toHaveBeenCalled();
  });

  it("the in-memory snapshot fast-path wins over the store value on StrictMode remount", () => {
    const workspace = makeWorkspace();
    const store = workspace.requireAdapter(LayoutStore);
    store.set({ panels: { fromFile: {} } });
    const host = new DockHost(workspace);
    const { api: api1, panels: panels1 } = makeFakeApi();
    host.setApi(api1 as unknown as DockviewApi);
    // Panel added after mount but before any persist — captured only in the api's live JSON.
    panels1.set("live", { id: "live", params: {}, focus: vi.fn() });
    host.detach(); // snapshots api1.toJSON() → _inMemoryLayout

    const { api: api2 } = makeFakeApi();
    host.setApi(api2 as unknown as DockviewApi);
    // StrictMode remount restores the just-captured snapshot ({live}), NOT the
    // older store value ({fromFile}) — proving the in-memory fast-path wins.
    expect(api2.fromJSON).toHaveBeenCalledTimes(1);
    expect(api2.fromJSON).toHaveBeenCalledWith({ panels: { live: {} } });
  });
});

describe("DockHost — deferred apply preserves fragment pre-alloc ordering", () => {
  it("applies the layout only AFTER a fragment onLoad registered after DockHost pre-allocs its specs", async () => {
    const workspace = makeWorkspace();
    const layoutStore = workspace.requireAdapter(LayoutStore);
    const specStore = workspace.requireAdapter(SpecStore);
    const savedLayout = { panels: { "pdf-viewer:/a.pdf": {} } };

    // 1. LayoutStore.connect registered FIRST (awaited): loads the saved layout.
    workspace.onLoad(async () => {
      await Promise.resolve(); // an awaited async listener, mirroring a real file read
      layoutStore.set(savedLayout); // stand in for connect() loading the file
    });

    // 2. DockHost registers its onLoad here (BEFORE the fragment below).
    const host = new DockHost(workspace);
    const { api } = makeFakeApi();
    let specPresentWhenApplied: boolean | null = null;
    api.fromJSON = vi.fn(() => {
      specPresentWhenApplied = specStore.get("spec:pdf-viewer:/a.pdf") != null;
    });
    host.setApi(api as unknown as DockviewApi); // cold mount: get() is null → default

    // 3. A fragment onLoad registered AFTER DockHost: pre-allocs its spec from the adapter layout.
    workspace.onLoad(() => {
      restorePanelSpecsFromLayout({
        store: specStore,
        layout: layoutStore.get(),
        panelIdPrefix: "pdf-viewer:",
        catalogId: "pdf-viewer",
        buildSpec: (uri) => ({ root: "panel", elements: { panel: { uri } } }) as never,
        buildSpecId: (uri) => `spec:pdf-viewer:${uri}`,
      });
    });

    await workspace.open();
    expect(api.fromJSON).not.toHaveBeenCalled(); // still deferred to a macrotask
    await flushMacrotask();

    expect(api.fromJSON).toHaveBeenCalledWith(savedLayout);
    // The apply saw the fragment's spec already allocated → no PanelMissing.
    expect(specPresentWhenApplied).toBe(true);
  });
});

describe("DockHost — real connect() wiring via workspace.open() (composition)", () => {
  it("restores a saved dock-layout.json on open() with NO test-only connect()/set()", async () => {
    const savedLayout = { panels: { "pdf-viewer:/a.pdf": {} } };

    // A real workspace whose SystemFiles already holds a saved layout file.
    const workspace = initWorkspace({ workspace: new Workspace(), filesApi: new MemFilesApi() });
    const sysFiles = workspace.requireAdapter(SystemFiles).files;
    await writeText(sysFiles, "/dock-layout.json", JSON.stringify(savedLayout));

    // Boot, exactly as production does — no test stubbing of the restore:
    // resolving the adapter self-registers its connect-on-onLoad in the ctor.
    const layoutStore = workspace.requireAdapter(LayoutStore);
    const specStore = workspace.requireAdapter(SpecStore);

    // A fragment-style pre-alloc onLoad, registered AFTER the adapter was
    // resolved (so the adapter's connect-onLoad precedes it and runs first).
    workspace.onLoad(() => {
      restorePanelSpecsFromLayout({
        store: specStore,
        layout: layoutStore.get(),
        panelIdPrefix: "pdf-viewer:",
        catalogId: "pdf-viewer",
        buildSpec: (uri) => ({ root: "panel", elements: { panel: { uri } } }) as never,
        buildSpecId: (uri) => `spec:pdf-viewer:${uri}`,
      });
    });

    // DockHost registers its own onLoad; cold mount → get() is null → default.
    const host = new DockHost(workspace);
    const { api } = makeFakeApi();
    let specPresentWhenApplied: boolean | null = null;
    api.fromJSON = vi.fn(() => {
      specPresentWhenApplied = specStore.get("spec:pdf-viewer:/a.pdf") != null;
    });
    host.setApi(api as unknown as DockviewApi);
    expect(api.fromJSON).not.toHaveBeenCalled(); // cold mount, default layout

    await workspace.open(); // drives the REAL LayoutStore.connect() — no set()
    await flushMacrotask(); // DockHost's deferred apply

    // connect() loaded the file → fragment pre-allocated its spec from it.
    expect(specStore.get("spec:pdf-viewer:/a.pdf")).not.toBeNull();
    // DockHost applied the saved layout, and the spec was present when it did.
    expect(api.fromJSON).toHaveBeenCalledWith(savedLayout);
    expect(specPresentWhenApplied).toBe(true);
  });
});
