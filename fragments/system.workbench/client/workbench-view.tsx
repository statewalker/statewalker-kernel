import { Toaster } from "@statewalker/ui.view.shadcn";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  chordOf,
  deviceModeOf,
  PALETTE_CHORDS,
  type Workbench,
  type WorkbenchState,
  ZONES,
  type Zone,
} from "../src/index.js";
import {
  ActivityBar,
  DialogHost,
  MenuBar,
  NotificationHost,
  Palette,
  StatusBar,
} from "./chrome.js";
import { WorkbenchContext, ZoneDock } from "./dock.js";
import { PhoneShell, ZoneDrawers } from "./zones.js";

/** The zones each dock holds: every zone on a desktop, the centre on a tablet. */
const DESKTOP_ZONES: readonly Zone[] = ZONES;
const TABLET_ZONES: readonly Zone[] = ["center"];

/** The workbench's state, re-read after every change to the model. */
function useWorkbenchState(workbench: Workbench): WorkbenchState {
  const [state, setState] = useState<WorkbenchState>();
  useEffect(() => workbench.observe(setState), [workbench]);
  return (
    state ?? {
      views: workbench.views(),
      opened: workbench.opened(),
      mode: workbench.mode(),
      layout: workbench.layout(),
      dialogs: workbench.dialogs.pending(),
      notifications: workbench.notifications.pending(),
      docked: workbench.docked(),
    }
  );
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
 * The workbench in the device mode its window's width gives (`deviceModeOf`; `followWidth`
 * false leaves the mode to the host):
 *
 * - desktop: the menu bar, the activity bar, one dockview whose groups are the left, right,
 *   bottom and centre zones, and the status bar;
 * - tablet: the same, with the centre in the dockview (panels dragged by touch) and the other
 *   zones as drawers;
 * - phone: one panel, a bottom tab bar, and a "More" menu with the rest and the menu bar's menus.
 *
 * Around them: the command palette (Ctrl/Cmd+Shift+P, F1), keyboard shortcuts, and the dialogs
 * and notifications fragments raise. A panel the user closes closes its view; a view that leaves
 * (its fragment disabled or removed) closes its panel.
 */
export function WorkbenchView({
  workbench,
  followWidth = true,
}: {
  workbench: Workbench;
  followWidth?: boolean;
}) {
  const state = useWorkbenchState(workbench);
  const [palette, setPalette] = useState(false);
  // The chrome's context: menus' and bars' `when` read it, so changes re-render them.
  const [dockActive, setDockActive] = useState<string>();
  const [inputFocus, setInputFocus] = useState(false);
  const activeView = state.mode === "phone" ? (state.layout.active ?? state.opened[0]) : dockActive;
  const context = useMemo(() => ({ activeView, inputFocus }), [activeView, inputFocus]);
  const activeViewRef = useRef<string | undefined>(undefined);
  activeViewRef.current = activeView;
  const paletteOpen = useRef(false);
  paletteOpen.current = palette;
  const onDockActive = useCallback((panel: string | undefined) => setDockActive(panel), []);

  // The device mode follows the window's width, set before the first paint.
  useLayoutEffect(() => {
    if (!followWidth) return;
    const apply = () => workbench.setMode(deviceModeOf(window.innerWidth));
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [workbench, followWidth]);

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

  const { mode } = state;
  return (
    <WorkbenchContext.Provider value={workbench}>
      <div
        data-testid="workbench"
        data-mode={mode}
        className="flex h-full w-full flex-col bg-background text-foreground"
      >
        {mode === "phone" ? (
          <PhoneShell workbench={workbench} state={state} context={context} />
        ) : (
          <>
            <MenuBar workbench={workbench} context={context} />
            <div className="flex min-h-0 flex-1">
              <ActivityBar workbench={workbench} />
              <div className="flex h-full min-w-0 flex-1 flex-col">
                {mode === "tablet" && <ZoneDrawers workbench={workbench} state={state} />}
                <ZoneDock
                  key={mode}
                  workbench={workbench}
                  zones={mode === "desktop" ? DESKTOP_ZONES : TABLET_ZONES}
                  dnd={mode === "desktop" ? "auto" : "pointer"}
                  onActive={onDockActive}
                />
              </div>
            </div>
            <StatusBar workbench={workbench} context={context} />
          </>
        )}
      </div>
      <Palette workbench={workbench} open={palette} onOpenChange={setPalette} />
      <DialogHost workbench={workbench} dialogs={state.dialogs} />
      <NotificationHost workbench={workbench} notifications={state.notifications} />
      <Toaster position="bottom-right" offset={mode === "phone" ? 56 : 36} />
    </WorkbenchContext.Provider>
  );
}
