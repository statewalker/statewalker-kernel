// The dock: one dockview whose groups are the workbench's zones (desktop: all four; tablet: the
// centre). It follows the model (panels added, moved between zones, closed, made active) and
// tells the model what the user does (closing a tab, dragging a panel to another zone, clicking
// a tab). Groups are tagged with their zone; a group the user splits off keeps the zone its first
// panel came from.
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@statewalker/ui.view.shadcn";
import {
  type AddPanelPositionOptions,
  type DockviewApi,
  type DockviewDndStrategy,
  type DockviewGroupPanel,
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
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  fillText,
  SURFACE_PANEL_PREFIX,
  type Workbench,
  type WorkbenchState,
  type Zone,
} from "../src/index.js";
import { contextMenuFamily, dropdownMenuFamily, MenuEntries } from "./menus.js";

export const WorkbenchContext = createContext<Workbench | undefined>(undefined);

/** Re-render after every change to the model (for parts rendered outside WorkbenchView's tree). */
export function useRevision(workbench: Workbench | undefined): void {
  const [, setRevision] = useState(0);
  useEffect(() => workbench?.observe(() => setRevision((r) => r + 1)), [workbench]);
}

interface ViewParams {
  readonly view: string;
}

interface SurfaceParams {
  readonly surface: string;
}

const isSurface = (id: string) => id.startsWith(SURFACE_PANEL_PREFIX);

/** What a group holds: a zone's views, or the docked surfaces (`dock`, at the right edge). */
type GroupTag = Zone | "dock";

/** A group of `zone`, if the dock has one. */
function groupOf(
  api: DockviewApi,
  tags: Map<string, GroupTag>,
  zone: GroupTag,
): DockviewGroupPanel | undefined {
  return api.groups.find((g) => tags.get(g.id) === zone);
}

/** Where a new group of `zone` goes: the sides and the bottom at the dock's edges. */
function positionFor(
  api: DockviewApi,
  tags: Map<string, GroupTag>,
  zone: GroupTag,
): AddPanelPositionOptions | undefined {
  // No group yet: the first one. Once there are groups, always an explicit place: dockview would
  // otherwise add to its active group, whatever zone (or the docked surfaces) it holds.
  if (api.groups.length === 0) return undefined;
  if (zone === "left") return { direction: "left" };
  if (zone === "dock") return { direction: "right" };
  if (zone === "right") {
    const dock = groupOf(api, tags, "dock");
    return dock ? { referenceGroup: dock, direction: "left" } : { direction: "right" };
  }
  if (zone === "bottom") return { direction: "below" };
  const left = groupOf(api, tags, "left");
  if (left) return { referenceGroup: left, direction: "right" };
  const right = groupOf(api, tags, "right");
  if (right) return { referenceGroup: right, direction: "left" };
  const bottom = groupOf(api, tags, "bottom");
  if (bottom) return { referenceGroup: bottom, direction: "above" };
  const dock = groupOf(api, tags, "dock");
  if (dock) return { referenceGroup: dock, direction: "left" };
  return { direction: "left" };
}

/**
 * Make the dock's panels the open views of `zones` and the docked surfaces: close the gone, add
 * the new ones to their zone's group, move those whose zone changed, and show the active view
 * when it changed since `shown` (a surface the user brings forward stays in front).
 */
function syncDock(
  api: DockviewApi,
  { views, layout, docked }: WorkbenchState,
  zones: readonly Zone[],
  tags: Map<string, GroupTag>,
  shown: string | undefined,
) {
  const want = new Map<string, GroupTag>();
  for (const zone of zones) for (const id of layout.zones[zone]) want.set(id, zone);
  for (const panel of [...api.panels]) {
    const keep = isSurface(panel.id) ? docked.some((d) => d.id === panel.id) : want.has(panel.id);
    if (!keep) panel.api.close();
  }
  const place = (id: string, zone: GroupTag, add: (position?: AddPanelPositionOptions) => void) => {
    const panel = api.getPanel(id);
    if (!panel) {
      const group = groupOf(api, tags, zone);
      add(group ? { referenceGroup: group, direction: "within" } : positionFor(api, tags, zone));
      const added = api.getPanel(id);
      if (added && !tags.has(added.group.id)) tags.set(added.group.id, zone);
      return;
    }
    if (!tags.has(panel.group.id)) tags.set(panel.group.id, zone);
    if (tags.get(panel.group.id) === zone) return;
    let group = groupOf(api, tags, zone);
    if (!group) {
      group = api.addGroup(positionFor(api, tags, zone) ?? { direction: "right" });
      tags.set(group.id, zone);
    }
    panel.api.moveTo({ group, position: "center" });
  };
  for (const [id, zone] of want) {
    const view = views.find((v) => v.id === id);
    if (!view) continue;
    place(id, zone, (position) =>
      api.addPanel<ViewParams>({
        id,
        component: "view",
        title: view.title,
        params: { view: id },
        ...(position ? { position } : {}),
      }),
    );
    // A view's title follows the interface language.
    const panel = api.getPanel(id);
    if (panel && panel.title !== view.title) panel.api.setTitle(view.title);
  }
  // Docked surfaces share a group of their own, at the right edge.
  for (const surface of docked) {
    place(surface.id, "dock", (position) =>
      api.addPanel<SurfaceParams>({
        id: surface.id,
        component: "surface",
        title: surface.title,
        params: { surface: surface.surfaceId },
        ...(position ? { position } : {}),
      }),
    );
  }
  const active = layout.active;
  if (active !== shown && active !== undefined && want.has(active)) {
    if (api.activePanel?.id !== active) api.getPanel(active)?.api.setActive();
  }
}

/**
 * The dock: the open views of `zones` in one dockview. `dnd` is dockview's drag strategy
 * (`pointer` on a tablet: touch and mouse drag alike). `onActive` hears the dock's active panel.
 */
export function ZoneDock({
  workbench,
  zones,
  dnd,
  onActive,
}: {
  workbench: Workbench;
  zones: readonly Zone[];
  dnd: DockviewDndStrategy;
  onActive: (panel: string | undefined) => void;
}) {
  const [api, setApi] = useState<DockviewApi>();
  // Cleared before dockview disposes its panels on unmount, so that is not read as the user
  // closing them.
  const alive = useRef(true);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!api) return;
    const tags = new Map<string, GroupTag>();
    let syncing = false;
    /** The model's active view the dock last showed. */
    let shown: string | undefined;
    const user = () => alive.current && !syncing;
    /** Read the zones back from the groups the user dragged panels to. */
    function readBack() {
      for (const panel of api?.panels ?? []) {
        if (isSurface(panel.id)) continue;
        const current = workbench.zoneOf(panel.id);
        if (current === undefined) continue;
        let tag = tags.get(panel.group.id);
        if (tag === undefined) {
          tag = current;
          tags.set(panel.group.id, tag);
        }
        // The docked surfaces' group is no zone: a view there keeps its zone, and the next sync
        // moves it back to that zone's group.
        if (tag === "dock") continue;
        if (tag !== current) workbench.move(panel.id, tag);
      }
    }
    const subscriptions = [
      api.onDidRemovePanel((panel) => {
        if (!user()) return;
        if (isSurface(panel.id))
          workbench.closeSurface(panel.id.slice(SURFACE_PANEL_PREFIX.length));
        else workbench.close(panel.id);
      }),
      api.onDidRemoveGroup((group) => {
        tags.delete(group.id);
      }),
      api.onDidActivePanelChange(({ panel }) => {
        if (!alive.current) return;
        onActive(panel?.id);
        if (user() && panel && !isSurface(panel.id)) workbench.setActive(panel.id);
      }),
      api.onDidLayoutChange(() => {
        if (user()) readBack();
      }),
    ];
    const stop = workbench.observe((state) => {
      syncing = true;
      try {
        syncDock(api, state, zones, tags, shown);
        shown = state.layout.active;
      } finally {
        syncing = false;
      }
      onActive(api.activePanel?.id);
    });
    return () => {
      stop();
      for (const s of subscriptions) s.dispose();
    };
  }, [api, workbench, zones, onActive]);

  return (
    <div data-testid="dock" data-dnd={dnd} className="h-full min-w-0 flex-1">
      <DockviewReact
        components={components}
        rightHeaderActionsComponent={ViewActions}
        onReady={(event: DockviewReadyEvent) => setApi(event.api)}
        theme={theme}
        dndStrategy={dnd}
        className="h-full w-full"
      />
    </div>
  );
}

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

function ViewPanel({ params }: IDockviewPanelProps<ViewParams>) {
  const workbench = useContext(WorkbenchContext);
  return workbench ? <ViewContent workbench={workbench} view={params.view} /> : null;
}

function SurfacePanel({ params }: IDockviewPanelProps<SurfaceParams>) {
  const workbench = useContext(WorkbenchContext);
  return workbench ? <SurfaceContent workbench={workbench} surface={params.surface} /> : null;
}

const components = { view: ViewPanel, surface: SurfacePanel };

/**
 * One open view, wherever it shows (a dock panel, a drawer, a phone's one panel): its
 * component, resolved through the view's lazy reference, with its context menu.
 */
export function ViewContent({ workbench, view }: { workbench: Workbench; view: string }) {
  const [loaded, setLoaded] = useState<{ View?: ComponentType; error?: unknown }>({});
  useEffect(() => {
    const entry = workbench.view(view);
    if (!entry) return;
    let live = true;
    setLoaded({});
    entry.component<ComponentType>().then(
      (View) => live && setLoaded({ View }),
      (error: unknown) => live && setLoaded({ error }),
    );
    return () => {
      live = false;
    };
  }, [workbench, view]);

  let content: ReactNode;
  if (loaded.error !== undefined) content = <ViewFailure view={view} error={loaded.error} />;
  else if (!loaded.View) content = <Loading />;
  else
    content = (
      <ViewBoundary view={view}>
        <loaded.View />
      </ViewBoundary>
    );
  return (
    <ViewContextMenu workbench={workbench} view={view}>
      {content}
    </ViewContextMenu>
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
export function SurfaceContent({ workbench, surface }: { workbench: Workbench; surface: string }) {
  const [loaded, setLoaded] = useState<{ Surface?: ComponentType; error?: unknown }>({});
  useEffect(() => {
    const docked = workbench.docked().find((d) => d.surfaceId === surface);
    if (!docked) return;
    let live = true;
    docked.component<ComponentType>().then(
      (Surface) => live && setLoaded({ Surface }),
      (error: unknown) => live && setLoaded({ error }),
    );
    return () => {
      live = false;
    };
  }, [workbench, surface]);

  const name = `surface ${surface}`;
  if (loaded.error !== undefined) return <ViewFailure view={name} error={loaded.error} />;
  if (!loaded.Surface) return <Loading />;
  return (
    <ViewBoundary view={name}>
      <div data-testid="docked-surface" data-surface={surface} className="h-full overflow-auto">
        <loaded.Surface />
      </div>
    </ViewBoundary>
  );
}

/** A view or surface still loading, in the interface language. */
function Loading() {
  const workbench = useContext(WorkbenchContext);
  return (
    <div className="p-4 text-sm text-muted-foreground">
      {workbench?.text("view.loading", "Loading…") ?? "Loading…"}
    </div>
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
