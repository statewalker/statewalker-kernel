import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  Toaster,
} from "@statewalker/ui.view.shadcn";
import {
  type DockviewApi,
  DockviewReact,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewHeaderActionsProps,
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
  useMemo,
  useRef,
  useState,
} from "react";
import {
  chordOf,
  fillText,
  PALETTE_CHORDS,
  SURFACE_PANEL_PREFIX,
  type Workbench,
  type WorkbenchState,
} from "../src/index.js";
import {
  ActivityBar,
  DialogHost,
  MenuBar,
  NotificationHost,
  Palette,
  StatusBar,
} from "./chrome.js";
import { contextMenuFamily, dropdownMenuFamily, MenuEntries } from "./menus.js";

const WorkbenchContext = createContext<Workbench | undefined>(undefined);

interface ViewParams {
  readonly view: string;
}

/** The workbench's state, re-read after every change to the model. */
function useWorkbenchState(workbench: Workbench): WorkbenchState {
  const [state, setState] = useState<WorkbenchState>();
  useEffect(() => workbench.observe(setState), [workbench]);
  return (
    state ?? {
      views: workbench.views(),
      opened: workbench.opened(),
      dialogs: workbench.dialogs.pending(),
      notifications: workbench.notifications.pending(),
      docked: workbench.docked(),
    }
  );
}

/** Re-render after every change to the model (for parts rendered outside WorkbenchView's tree). */
function useRevision(workbench: Workbench | undefined): void {
  const [, setRevision] = useState(0);
  useEffect(() => workbench?.observe(() => setRevision((r) => r + 1)), [workbench]);
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
    const existing = api.getPanel(id);
    const view = views.find((v) => v.id === id);
    if (existing) {
      // A view's title follows the interface language.
      if (view && existing.title !== view.title) existing.api.setTitle(view.title);
      continue;
    }
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

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * The workbench: the menu bar, the activity bar, one dockview whose panels are the open views,
 * the status bar, the command palette (Ctrl/Cmd+Shift+P, F1), keyboard shortcuts, and the
 * dialogs and notifications fragments raise. A panel the user closes closes its view; a view
 * that leaves (its fragment disabled or removed) closes its panel.
 */
export function WorkbenchView({ workbench }: { workbench: Workbench }) {
  const state = useWorkbenchState(workbench);
  const [api, setApi] = useState<DockviewApi>();
  const [palette, setPalette] = useState(false);
  // The chrome's context: menus' and bars' `when` read it, so changes re-render them.
  const [activeView, setActiveView] = useState<string>();
  const [inputFocus, setInputFocus] = useState(false);
  const context = useMemo(() => ({ activeView, inputFocus }), [activeView, inputFocus]);
  const activeViewRef = useRef<string | undefined>(undefined);
  activeViewRef.current = activeView;
  const paletteOpen = useRef(false);
  paletteOpen.current = palette;

  useEffect(() => {
    const focusIn = (event: FocusEvent) => setInputFocus(isTextInput(event.target));
    const focusOut = (event: FocusEvent) => setInputFocus(isTextInput(event.relatedTarget));
    document.addEventListener("focusin", focusIn);
    document.addEventListener("focusout", focusOut);
    return () => {
      document.removeEventListener("focusin", focusIn);
      document.removeEventListener("focusout", focusOut);
    };
  }, []);

  useEffect(() => {
    if (!api) return;
    const closed = api.onDidRemovePanel((panel) =>
      panel.id.startsWith(SURFACE_PANEL_PREFIX)
        ? workbench.closeSurface(panel.id.slice(SURFACE_PANEL_PREFIX.length))
        : workbench.close(panel.id),
    );
    setActiveView(api.activePanel?.id);
    const active = api.onDidActivePanelChange(({ panel }) => setActiveView(panel?.id));
    const stop = workbench.observe((state) => syncPanels(api, state));
    return () => {
      stop();
      closed.dispose();
      active.dispose();
    };
  }, [api, workbench]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // A modal answer is pending: keys belong to it.
      if (workbench.dialogs.pending().length > 0 || paletteOpen.current) return;
      const chord = chordOf(event);
      if (chord !== undefined && PALETTE_CHORDS.includes(chord)) {
        event.preventDefault();
        setPalette(true);
        return;
      }
      const command = workbench.keyCommand(event, {
        activeView: activeViewRef.current,
        inputFocus: isTextInput(event.target),
      });
      if (command === undefined) return;
      event.preventDefault();
      void workbench.execute(command);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [workbench]);

  return (
    <WorkbenchContext.Provider value={workbench}>
      <div className="flex h-full w-full flex-col bg-background text-foreground">
        <MenuBar workbench={workbench} context={context} />
        <div className="flex min-h-0 flex-1">
          <ActivityBar workbench={workbench} />
          <div data-testid="workbench" className="h-full min-w-0 flex-1">
            <DockviewReact
              components={components}
              rightHeaderActionsComponent={ViewActions}
              onReady={(event: DockviewReadyEvent) => setApi(event.api)}
              theme={theme}
              className="h-full w-full"
            />
          </div>
        </div>
        <StatusBar workbench={workbench} context={context} />
      </div>
      <Palette workbench={workbench} open={palette} onOpenChange={setPalette} />
      <DialogHost workbench={workbench} dialogs={state.dialogs} />
      <NotificationHost workbench={workbench} notifications={state.notifications} />
      <Toaster position="bottom-right" offset={36} />
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

/** The group's tab-bar menu: the `view/title` entries for its active view. */
function ViewActions({ activePanel }: IDockviewHeaderActionsProps) {
  const workbench = useContext(WorkbenchContext);
  useRevision(workbench);
  const view = activePanel?.id;
  const nodes = workbench && view ? workbench.menu("view/title", { view, activeView: view }) : [];
  if (!workbench || nodes.length === 0) return null;
  return (
    <div className="flex h-full items-center px-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={workbench.text("view.actions", "View actions")}
          >
            <span aria-hidden="true">⋯</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <MenuEntries
            nodes={nodes}
            family={dropdownMenuFamily}
            run={(command) => void workbench.execute(command)}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

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

  let content: ReactNode;
  if (loaded.error !== undefined) content = <ViewFailure view={params.view} error={loaded.error} />;
  else if (!loaded.View)
    content = (
      <div className="p-4 text-sm text-muted-foreground">
        {workbench?.text("view.loading", "Loading…") ?? "Loading…"}
      </div>
    );
  else
    content = (
      <ViewBoundary view={params.view}>
        <loaded.View />
      </ViewBoundary>
    );
  return workbench ? (
    <ViewContextMenu workbench={workbench} view={params.view}>
      {content}
    </ViewContextMenu>
  ) : (
    content
  );
}

/** The `view/context` entries for this view, on right click; none: the browser's own menu. */
function ViewContextMenu({
  workbench,
  view,
  children,
}: {
  workbench: Workbench;
  view: string;
  children: ReactNode;
}) {
  useRevision(workbench);
  const nodes = workbench.menu("view/context", { view, activeView: view });
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={nodes.length === 0}>
        <div className="h-full w-full overflow-auto">{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <MenuEntries
          nodes={nodes}
          family={contextMenuFamily}
          run={(command) => void workbench.execute(command)}
        />
      </ContextMenuContent>
    </ContextMenu>
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
  if (!loaded.Surface) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {workbench?.text("view.loading", "Loading…") ?? "Loading…"}
      </div>
    );
  }
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
  const workbench = useContext(WorkbenchContext);
  const params = { view, error: error instanceof Error ? error.message : String(error) };
  const fallback = "The view {view} failed: {error}";
  return (
    <div role="alert" className="p-4 text-sm text-destructive">
      {workbench ? workbench.text("view.failed", fallback, params) : fillText(fallback, params)}
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
