// The zones outside the dock: a tablet's side and bottom zones as drawers, and a phone's one
// panel with its bottom tab bar and "More" menu. Both render the model's layout of their mode.
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@statewalker/ui.view.shadcn";
import { useEffect, useState } from "react";
import type { WhenContext, Workbench, WorkbenchState, Zone } from "../src/index.js";
import { SurfaceContent, ViewContent } from "./dock.js";
import { dropdownMenuFamily, MenuEntries } from "./menus.js";

const SIDE_ZONES = ["left", "right", "bottom"] as const;
type SideZone = (typeof SIDE_ZONES)[number];

const ZONE_LABELS: Record<Zone, string> = {
  center: "Centre zone",
  left: "Left zone",
  right: "Right zone",
  bottom: "Bottom zone",
};

const titleOf = (state: WorkbenchState, id: string) =>
  state.views.find((v) => v.id === id)?.title ?? id;

/**
 * A tablet's side and bottom zones: a button per zone in a strip above the dock, each opening
 * its zone as a drawer over the dock. A view made active in a side zone opens its drawer.
 */
export function ZoneDrawers({ workbench, state }: { workbench: Workbench; state: WorkbenchState }) {
  const [open, setOpen] = useState<SideZone>();
  const { layout } = state;
  const activeZone = layout.active === undefined ? undefined : workbench.zoneOf(layout.active);
  useEffect(() => {
    if (activeZone && activeZone !== "center") setOpen(activeZone);
  }, [activeZone, layout.active]);
  return (
    <>
      <div
        data-testid="zone-strip"
        className="flex h-8 shrink-0 items-center gap-1 border-b bg-muted px-2 text-xs"
      >
        {SIDE_ZONES.map((zone) => (
          <Button
            key={zone}
            variant={open === zone ? "secondary" : "ghost"}
            size="sm"
            className={zone === "right" ? "ml-auto h-6" : "h-6"}
            aria-label={ZONE_LABELS[zone]}
            aria-expanded={open === zone}
            onClick={() => setOpen(open === zone ? undefined : zone)}
          >
            {ZONE_LABELS[zone].replace(" zone", "")} ({layout.zones[zone].length})
          </Button>
        ))}
      </div>
      {open && (
        <Drawer
          zone={open}
          workbench={workbench}
          state={state}
          onClose={() => setOpen(undefined)}
        />
      )}
    </>
  );
}

const DRAWER_PLACES: Record<SideZone, string> = {
  left: "inset-y-0 left-0 w-80 max-w-[85vw] border-r",
  right: "inset-y-0 right-0 w-80 max-w-[85vw] border-l",
  bottom: "inset-x-0 bottom-0 h-1/2 border-t",
};

function Drawer({
  zone,
  workbench,
  state,
  onClose,
}: {
  zone: SideZone;
  workbench: Workbench;
  state: WorkbenchState;
  onClose: () => void;
}) {
  const ids = state.layout.zones[zone];
  const active = state.layout.active;
  const [local, setLocal] = useState<string>();
  const shown =
    active !== undefined && ids.includes(active)
      ? active
      : local !== undefined && ids.includes(local)
        ? local
        : ids[0];
  return (
    <>
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
      />
      <section
        aria-label={ZONE_LABELS[zone]}
        data-zone={zone}
        className={`fixed z-50 flex flex-col bg-background text-foreground shadow-lg ${DRAWER_PLACES[zone]}`}
      >
        <header className="flex h-9 shrink-0 items-center gap-1 border-b bg-muted px-1">
          <div role="tablist" aria-label={ZONE_LABELS[zone]} className="flex min-w-0 flex-1 gap-1">
            {ids.map((id) => (
              <span key={id} className="flex items-center">
                <button
                  type="button"
                  role="tab"
                  aria-selected={id === shown}
                  className={`rounded-sm px-2 py-1 text-sm ${id === shown ? "bg-background" : "text-muted-foreground"}`}
                  onClick={() => {
                    setLocal(id);
                    workbench.setActive(id);
                  }}
                >
                  {titleOf(state, id)}
                </button>
                <button
                  type="button"
                  aria-label={`Close ${titleOf(state, id)}`}
                  className="px-1 text-muted-foreground"
                  onClick={() => workbench.close(id)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <Button variant="ghost" size="icon-xs" aria-label="Close drawer" onClick={onClose}>
            <span aria-hidden="true">✕</span>
          </Button>
        </header>
        <div className="min-h-0 flex-1">
          {shown ? (
            <ViewContent workbench={workbench} view={shown} />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">No views here.</p>
          )}
        </div>
      </section>
    </>
  );
}

/** How many entries the phone's tab bar shows before the rest go to "More". */
export const PHONE_TABS = 4;

interface PhoneEntry {
  readonly id: string;
  readonly title: string;
  readonly surface?: string;
}

/**
 * A phone: one panel (the active view, or a docked surface), a bottom tab bar of the open views
 * and docked surfaces, and a "More" menu with the rest, the views not open and the menu bar's
 * menus.
 */
export function PhoneShell({
  workbench,
  state,
  context,
}: {
  workbench: Workbench;
  state: WorkbenchState;
  context: WhenContext;
}) {
  const [surfaceShown, setSurfaceShown] = useState<string>();
  const entries: PhoneEntry[] = [
    ...state.opened.map((id) => ({ id, title: titleOf(state, id) })),
    ...state.docked.map((d) => ({ id: d.id, title: d.title, surface: d.surfaceId })),
  ];
  const surface = state.docked.find((d) => d.surfaceId === surfaceShown);
  const shownId = surface?.id ?? state.layout.active ?? state.opened[0];
  const shown = entries.find((e) => e.id === shownId);
  let tabs = entries.slice(0, PHONE_TABS);
  if (shown && !tabs.includes(shown)) tabs = [...tabs.slice(0, PHONE_TABS - 1), shown];
  const overflow = entries.filter((e) => !tabs.includes(e));
  const closed = state.views.filter((v) => !state.opened.includes(v.id));
  const menus = workbench.menu("menubar", context);
  const show = (entry: PhoneEntry) => {
    if (entry.surface) {
      setSurfaceShown(entry.surface);
      return;
    }
    setSurfaceShown(undefined);
    workbench.setActive(entry.id);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b bg-muted px-3">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{shown?.title ?? ""}</h1>
        {shown && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Close ${shown.title}`}
            onClick={() =>
              shown.surface ? workbench.closeSurface(shown.surface) : workbench.close(shown.id)
            }
          >
            <span aria-hidden="true">✕</span>
          </Button>
        )}
      </header>
      <main data-testid="phone-panel" className="min-h-0 flex-1 overflow-auto">
        {shown?.surface ? (
          <SurfaceContent workbench={workbench} surface={shown.surface} />
        ) : shown ? (
          <ViewContent key={shown.id} workbench={workbench} view={shown.id} />
        ) : (
          <p className="p-4 text-sm text-muted-foreground">Open a view from More.</p>
        )}
      </main>
      <nav className="flex h-12 shrink-0 items-stretch border-t bg-muted" aria-label="Tab bar">
        <div role="tablist" aria-label="Views" className="flex min-w-0 flex-1">
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={entry === shown}
              className={`min-w-0 flex-1 truncate px-2 text-sm ${entry === shown ? "font-semibold text-foreground" : "text-muted-foreground"}`}
              onClick={() => show(entry)}
            >
              {entry.title}
            </button>
          ))}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-full rounded-none px-4" aria-label="More">
              More
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top">
            {overflow.map((entry) => (
              <DropdownMenuItem key={entry.id} onSelect={() => show(entry)}>
                {entry.title}
              </DropdownMenuItem>
            ))}
            {overflow.length > 0 && closed.length > 0 && <DropdownMenuSeparator />}
            {closed.length > 0 && <DropdownMenuLabel>Open</DropdownMenuLabel>}
            {closed.map((view) => (
              <DropdownMenuItem
                key={view.id}
                onSelect={() => {
                  setSurfaceShown(undefined);
                  workbench.open(view.id);
                }}
              >
                {view.title}
              </DropdownMenuItem>
            ))}
            {menus.length > 0 && <DropdownMenuSeparator />}
            <MenuEntries
              nodes={menus}
              family={dropdownMenuFamily}
              run={(command) => void workbench.execute(command)}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
    </div>
  );
}
