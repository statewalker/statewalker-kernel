import { type ComponentType, createElement, useMemo, useState, useSyncExternalStore } from "react";
import { type A2ui, type A2uiState, installedA2ui } from "../src/index.js";
import { createRegistry } from "./registry.js";
import { A2uiSurface } from "./renderer.js";

function useA2uiState(a2ui: A2ui): A2uiState {
  const [store] = useState(() => {
    let current: A2uiState = { components: a2ui.components(), surfaces: a2ui.surfaces() };
    return {
      subscribe(onChange: () => void) {
        return a2ui.observe((state) => {
          current = state;
          onChange();
        });
      },
      get: () => current,
    };
  });
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export interface A2uiSurfaceViewProps {
  readonly surfaceId: string;
  /** The model; the installed one by default (`installA2ui`). */
  readonly a2ui?: A2ui;
  /** Where this view stands: inline (its sender's place), or in the dock. */
  readonly where?: "inline" | "dock";
}

/**
 * A surface with its placement controls. Inline, it renders the surface with a "Pop out"
 * button, or, while the surface is docked, a placeholder with "Bring back". In the dock, it
 * renders the surface with "Back inline".
 */
export function A2uiSurfaceView({
  surfaceId,
  a2ui: given,
  where = "inline",
}: A2uiSurfaceViewProps) {
  const a2ui = given ?? installedA2ui();
  const state = useA2uiState(a2ui);
  const registry = useMemo(() => createRegistry(state.components), [state.components]);
  const [error, setError] = useState<string>();
  const info = state.surfaces.find((s) => s.id === surfaceId);
  const surface = a2ui.surface(surfaceId);
  const move = (to: "out" | "in") => {
    setError(undefined);
    (to === "out" ? a2ui.popOut(surfaceId) : a2ui.popIn(surfaceId)).catch((e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  };

  if (!info || !surface) {
    return (
      <div
        role="status"
        className="p-2 text-sm text-muted-foreground"
        data-surface-missing={surfaceId}
      >
        The surface {surfaceId} is gone.
      </div>
    );
  }
  const docked = info.placement === "docked";
  const failure = error ? (
    <div role="alert" className="text-sm text-destructive">
      {error}
    </div>
  ) : null;
  if (where === "inline" && docked) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-dashed p-2 text-sm text-muted-foreground"
        data-surface-placeholder={surfaceId}
      >
        <span>{info.title} is shown in the dock.</span>
        <button type="button" className="rounded-md border px-2 py-0.5" onClick={() => move("in")}>
          Bring back
        </button>
        {failure}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" data-surface-view={surfaceId} data-where={where}>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          className="rounded-md border px-2 py-0.5 text-sm"
          onClick={() => move(where === "dock" ? "in" : "out")}
        >
          {where === "dock" ? "Back inline" : "Pop out"}
        </button>
      </div>
      {failure}
      <A2uiSurface key={surface.id} surface={surface} registry={registry} />
    </div>
  );
}

/**
 * The workbench's surface source (`Workbench.setSurfaceSource`) for this model: a docked
 * surface renders as `A2uiSurfaceView` in the dock, and the model learns where each surface is.
 */
export function createSurfaceDock(a2ui: A2ui) {
  const views = new Map<string, ComponentType>();
  return {
    title: (surfaceId: string) => a2ui.surfaces().find((s) => s.id === surfaceId)?.title,
    component(surfaceId: string): ComponentType {
      let view = views.get(surfaceId);
      if (!view) {
        const Docked = () => createElement(A2uiSurfaceView, { a2ui, surfaceId, where: "dock" });
        Docked.displayName = `DockedSurface(${surfaceId})`;
        view = Docked;
        views.set(surfaceId, view);
      }
      return view;
    },
    docked(surfaceId: string, docked: boolean) {
      if (!docked) views.delete(surfaceId);
      a2ui.setDocked(surfaceId, docked);
    },
    /** A surface the model drops leaves the dock (the workbench subscribes). */
    onRemoved(listener: (surfaceId: string) => void) {
      return a2ui.onRemoved((surfaceId) => {
        views.delete(surfaceId);
        listener(surfaceId);
      });
    },
  };
}
