import type { ActivationContext, Extension } from "@statewalker/kernel.core";
import { VIEWS_POINT } from "./archive.js";
import { WorkbenchError } from "./errors.js";

/** A view contributed to the `views` point, as the workbench lists it. */
export interface ViewEntry {
  /** The view's identity, `<fragment-id>/<view-id>`. */
  readonly id: string;
  /** The view's id within its fragment. */
  readonly viewId: string;
  /** The contributing fragment. */
  readonly fragment: string;
  readonly title: string;
  readonly extension: Extension;
  /**
   * The view's component, resolved through the extension's lazy reference. Rejects with the
   * kernel's `ExtensionUnavailable` once the contributor is gone.
   */
  component<T = unknown>(): Promise<T>;
}

/**
 * Where docked surfaces come from (system.a2ui's surfaces, wired by the host): the workbench
 * shows them without knowing how they render.
 */
export interface SurfaceSource {
  /** The surface's default title, or `undefined` when the source holds no such surface. */
  title(surfaceId: string): string | undefined;
  /** The surface's component (in a browser, a React component rendering it). */
  component(surfaceId: string): unknown;
  /** Told when the surface enters (`true`) and leaves (`false`) the dock. */
  docked(surfaceId: string, docked: boolean): void;
}

/** A surface popped out into the dock. */
export interface DockedSurface {
  /** Its panel id, `surface:<surfaceId>`. */
  readonly id: string;
  readonly surfaceId: string;
  readonly title: string;
  /** The surface's component, from the source. */
  component<T = unknown>(): Promise<T>;
}

/** What the workbench shows: the views there are, those open in the order opened, and the dock. */
export interface WorkbenchState {
  readonly views: readonly ViewEntry[];
  readonly opened: readonly string[];
  readonly docked: readonly DockedSurface[];
}

/** The workbench model: which views exist and which are open. Rendered by `./client`. */
export interface Workbench {
  /** The live views, in the order their extensions are read. */
  views(): readonly ViewEntry[];
  /** The live view `id` (`<fragment-id>/<view-id>`). */
  view(id: string): ViewEntry | undefined;
  /** The open views' identities, in the order they were opened. */
  opened(): readonly string[];
  /** Open the view `id`; a view already open stays where it is. Throws `WorkbenchError`. */
  open(id: string): void;
  /** Close the view `id`, when open. */
  close(id: string): void;
  /** Set (or clear) where docked surfaces come from; clearing it empties the dock. */
  setSurfaceSource(source: SurfaceSource | undefined): void;
  /**
   * Pop the surface `surfaceId` out into the dock (`system.workbench/open-surface`); a surface
   * docked already stays. Throws `WorkbenchError` (`unknown-surface`).
   */
  openSurface(surfaceId: string, options?: { title?: string }): void;
  /** Take the surface out of the dock (`system.workbench/close-surface`), when docked. */
  closeSurface(surfaceId: string): void;
  /** The docked surfaces, in the order docked. */
  docked(): readonly DockedSurface[];
  /**
   * Follow the workbench: `listener` is called at once, then after every change to the views,
   * the open views or the dock. Returns a disposer.
   */
  observe(listener: (state: WorkbenchState) => void): () => void;
}

/** The handlers of the fragment's commands, as its extensions' references name them. */
export interface WorkbenchModule {
  readonly openSurface: (input: { surfaceId: string; title?: string }) => Record<string, never>;
  readonly closeSurface: (input: { surfaceId: string }) => Record<string, never>;
  readonly [name: string]: unknown;
}

/** The system.workbench fragment's headless code: its model and its client activator body. */
export interface SystemWorkbench {
  readonly workbench: Workbench;
  /**
   * The fragment's client module: what its own extensions' references (`./index.js`) resolve
   * to. A host resolves a core fragment's references to this in-process module.
   */
  readonly module: WorkbenchModule;
  /** Activate the client aspect: follow the `views` point. Returns the cleanup. */
  activate(context: ActivationContext): () => void;
}

interface ViewData {
  readonly id: string;
  readonly title: string;
}

function entryOf(extension: Extension): ViewEntry {
  const data = extension.data as ViewData;
  const id = `${extension.contributor}/${data.id}`;
  return {
    id,
    viewId: data.id,
    fragment: extension.contributor,
    title: data.title,
    extension,
    async component<T>() {
      if (!extension.reference) throw new WorkbenchError("no-component", id);
      return extension.reference.resolve<T>();
    },
  };
}

/** The prefix of a docked surface's panel id. */
export const SURFACE_PANEL_PREFIX = "surface:";

export function createSystemWorkbench(): SystemWorkbench {
  let views: readonly ViewEntry[] = [];
  let opened: readonly string[] = [];
  let docked: readonly DockedSurface[] = [];
  let source: SurfaceSource | undefined;
  const listeners = new Set<(state: WorkbenchState) => void>();
  const state = (): WorkbenchState => ({ views, opened, docked });
  function notify() {
    const current = state();
    for (const listener of [...listeners]) {
      try {
        listener(current);
      } catch (error) {
        console.error("[system.workbench] a listener threw:", error);
      }
    }
  }

  function tell(surfaceId: string, isDocked: boolean) {
    try {
      source?.docked(surfaceId, isDocked);
    } catch (error) {
      console.error("[system.workbench] a surface source threw:", error);
    }
  }

  /** Empty the dock, telling the source each surface left it. */
  function undockAll() {
    if (docked.length === 0) return;
    const left = docked;
    docked = [];
    for (const d of left) tell(d.surfaceId, false);
    notify();
  }

  /** The live views are those of `extensions`, the first per identity winning. */
  function sync(extensions: readonly Extension[]) {
    const next = new Map<string, ViewEntry>();
    for (const extension of extensions) {
      const entry = entryOf(extension);
      if (!next.has(entry.id)) next.set(entry.id, entry);
    }
    views = [...next.values()];
    opened = opened.filter((id) => next.has(id));
    notify();
  }

  const workbench: Workbench = {
    views: () => views,
    view: (id) => views.find((v) => v.id === id),
    opened: () => opened,
    open(id) {
      if (!workbench.view(id)) throw new WorkbenchError("unknown-view", id);
      if (opened.includes(id)) return;
      opened = [...opened, id];
      notify();
    },
    close(id) {
      if (!opened.includes(id)) return;
      opened = opened.filter((o) => o !== id);
      notify();
    },
    setSurfaceSource(next) {
      if (source === next) return;
      undockAll();
      source = next;
    },
    openSurface(surfaceId, options = {}) {
      const title = source?.title(surfaceId);
      if (!source || title === undefined) throw new WorkbenchError("unknown-surface", surfaceId);
      if (docked.some((d) => d.surfaceId === surfaceId)) return;
      const from = source;
      docked = [
        ...docked,
        {
          id: `${SURFACE_PANEL_PREFIX}${surfaceId}`,
          surfaceId,
          title: options.title ?? title,
          component: async <T>() => (await from.component(surfaceId)) as T,
        },
      ];
      from.docked(surfaceId, true);
      notify();
    },
    closeSurface(surfaceId) {
      if (!docked.some((d) => d.surfaceId === surfaceId)) return;
      docked = docked.filter((d) => d.surfaceId !== surfaceId);
      tell(surfaceId, false);
      notify();
    },
    docked: () => docked,
    observe(listener) {
      const own = (s: WorkbenchState) => listener(s);
      listeners.add(own);
      own(state());
      return () => {
        listeners.delete(own);
      };
    },
  };

  const module: WorkbenchModule = {
    openSurface({ surfaceId, title }) {
      workbench.openSurface(surfaceId, title === undefined ? {} : { title });
      return {};
    },
    closeSurface({ surfaceId }) {
      workbench.closeSurface(surfaceId);
      return {};
    },
  };

  return {
    workbench,
    module,
    activate(context) {
      const stop = context.extensions.observe(VIEWS_POINT, (all) => sync(all));
      return () => {
        stop();
        views = [];
        opened = [];
        undockAll();
        notify();
      };
    },
  };
}
