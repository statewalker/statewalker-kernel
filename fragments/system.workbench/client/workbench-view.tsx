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
import type { Workbench, WorkbenchState } from "../src/index.js";

const WorkbenchContext = createContext<Workbench | undefined>(undefined);

interface ViewParams {
  readonly view: string;
}

/** Make the dock's panels the open views: add the newly opened, close the closed. */
function syncPanels(api: DockviewApi, { views, opened }: WorkbenchState) {
  for (const panel of [...api.panels]) {
    if (!opened.includes(panel.id)) panel.api.close();
  }
  for (const id of opened) {
    if (api.getPanel(id)) continue;
    const view = views.find((v) => v.id === id);
    if (!view) continue;
    api.addPanel<ViewParams>({ id, component: "view", title: view.title, params: { view: id } });
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
    const closed = api.onDidRemovePanel((panel) => workbench.close(panel.id));
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

const components = { view: ViewPanel };

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
