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

/** What the workbench shows: the views there are, and those open, in the order opened. */
export interface WorkbenchState {
  readonly views: readonly ViewEntry[];
  readonly opened: readonly string[];
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
  /**
   * Follow the workbench: `listener` is called at once, then after every change to the views
   * or the open views. Returns a disposer.
   */
  observe(listener: (state: WorkbenchState) => void): () => void;
}

/** The system.workbench fragment's headless code: its model and its client activator body. */
export interface SystemWorkbench {
  readonly workbench: Workbench;
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

export function createSystemWorkbench(): SystemWorkbench {
  let views: readonly ViewEntry[] = [];
  let opened: readonly string[] = [];
  const listeners = new Set<(state: WorkbenchState) => void>();
  const state = (): WorkbenchState => ({ views, opened });
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
    observe(listener) {
      const own = (s: WorkbenchState) => listener(s);
      listeners.add(own);
      own(state());
      return () => {
        listeners.delete(own);
      };
    },
  };

  return {
    workbench,
    activate(context) {
      const stop = context.extensions.observe(VIEWS_POINT, (all) => sync(all));
      return () => {
        stop();
        views = [];
        opened = [];
        notify();
      };
    },
  };
}
