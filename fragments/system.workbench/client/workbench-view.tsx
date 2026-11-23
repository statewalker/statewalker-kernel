import {
  type DockviewApi,
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewPanelProps,
  themeLight,
} from "dockview-react";
import {
  Component,
  type ComponentType,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { SURFACE_PANEL_PREFIX, type Workbench, type WorkbenchState } from "../src/index.js";

const WorkbenchContext = createContext<Workbench | undefined>(undefined);

interface ViewParams {
  readonly view: string;
}

interface SurfaceParams {
  readonly surface: string;
}

/**
 * Make the dockview's panels the open views and the docked surfaces: add the new ones, close the
 * gone. Docked surfaces share one group on the right, the dock zone.
 */
function syncPanels(api: DockviewApi, { views, opened, docked }: WorkbenchState) {
  for (const panel of [...api.panels]) {
    if (!opened.includes(panel.id) && !docked.some((d) => d.id === panel.id)) panel.api.close();
  }
  for (const id of opened) {
    if (api.getPanel(id)) continue;
    const view = views.find((v) => v.id === id);
    if (!view) continue;
    api.addPanel<ViewParams>({ id, component: "view", title: view.title, params: { view: id } });
  }
  for (const surface of docked) {
    if (api.getPanel(surface.id)) continue;
    const zone = api.panels.find((p) => p.id.startsWith(SURFACE_PANEL_PREFIX));
    api.addPanel<SurfaceParams>({
      id: surface.id,
      component: "surface",
      title: surface.title,
      params: { surface: surface.surfaceId },
      position: zone
        ? { referencePanel: zone.id, direction: "within" }
        : { direction: api.panels.length > 0 ? "right" : "within" },
    });
  }
}

/**
 * The workbench: one dockview whose panels are the open views. A panel the user closes closes
 * its view; a view that leaves (its fragment disabled or removed) closes its panel.
 */
export function WorkbenchView({ workbench }: { workbench: Workbench }) {
  const [api, setApi] = useState<DockviewApi>();

  useEffect(() => {
    if (!api) return;
    const closed = api.onDidRemovePanel((panel) =>
      panel.id.startsWith(SURFACE_PANEL_PREFIX)
        ? workbench.closeSurface(panel.id.slice(SURFACE_PANEL_PREFIX.length))
        : workbench.close(panel.id),
    );
    const stop = workbench.observe((state) => syncPanels(api, state));
    return () => {
      stop();
      closed.dispose();
    };
  }, [api, workbench]);

  return (
    <WorkbenchContext.Provider value={workbench}>
      <div data-testid="workbench" className="h-full w-full bg-background text-foreground">
        <DockviewReact
          components={components}
          onReady={(event: DockviewReadyEvent) => setApi(event.api)}
          theme={theme}
          className="h-full w-full"
        />
      </div>
    </WorkbenchContext.Provider>
  );
}

const components = { view: ViewPanel, surface: SurfacePanel };

/** dockview's light theme with its colours taken from the shadcn tokens (client/styles.css). */
const theme: DockviewTheme = {
  ...themeLight,
  name: "workbench",
  className: `${themeLight.className} dockview-theme-workbench`,
};

/** One open view: its component, resolved through the view's lazy reference. */
function ViewPanel({ params }: IDockviewPanelProps<ViewParams>) {
  const workbench = useContext(WorkbenchContext);
  const [loaded, setLoaded] = useState<{ View?: ComponentType; error?: unknown }>({});
  useEffect(() => {
    const view = workbench?.view(params.view);
    if (!view) return;
    let live = true;
    view.component<ComponentType>().then(
      (View) => live && setLoaded({ View }),
      (error: unknown) => live && setLoaded({ error }),
    );
    return () => {
      live = false;
    };
  }, [workbench, params.view]);

  if (loaded.error !== undefined) return <ViewFailure view={params.view} error={loaded.error} />;
  if (!loaded.View) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  return (
    <ViewBoundary view={params.view}>
      <loaded.View />
    </ViewBoundary>
  );
}

/** One docked surface: its component, from the workbench's surface source. */
function SurfacePanel({ params }: IDockviewPanelProps<SurfaceParams>) {
  const workbench = useContext(WorkbenchContext);
  const [loaded, setLoaded] = useState<{ Surface?: ComponentType; error?: unknown }>({});
  useEffect(() => {
    const surface = workbench?.docked().find((d) => d.surfaceId === params.surface);
    if (!surface) return;
    let live = true;
    surface.component<ComponentType>().then(
      (Surface) => live && setLoaded({ Surface }),
      (error: unknown) => live && setLoaded({ error }),
    );
    return () => {
      live = false;
    };
  }, [workbench, params.surface]);

  const name = `surface ${params.surface}`;
  if (loaded.error !== undefined) return <ViewFailure view={name} error={loaded.error} />;
  if (!loaded.Surface) return <div className="p-4 text-sm text-muted-foreground">Loading…</div>;
  return (
    <ViewBoundary view={name}>
      <div
        data-testid="docked-surface"
        data-surface={params.surface}
        className="h-full overflow-auto"
      >
        <loaded.Surface />
      </div>
    </ViewBoundary>
  );
}

function ViewFailure({ view, error }: { view: string; error: unknown }) {
  return (
    <div role="alert" className="p-4 text-sm text-destructive">
      The view {view} failed: {error instanceof Error ? error.message : String(error)}
    </div>
  );
}

/** A view that throws while rendering shows its error in its panel; the rest goes on. */
class ViewBoundary extends Component<{ view: string; children: ReactNode }, { error?: unknown }> {
  override state: { error?: unknown } = {};
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override render() {
    if (this.state.error !== undefined)
      return <ViewFailure view={this.props.view} error={this.state.error} />;
    return this.props.children;
  }
}
