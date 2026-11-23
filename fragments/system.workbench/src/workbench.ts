import type { ActivationContext, Extension } from "@statewalker/kernel.core";
import { type CommandBus, type CommandEntry, labelsOf } from "@statewalker/system.commands";
import {
  ACTIVITYBAR_POINT,
  COMMAND_FAILED_NOTIFICATION,
  DIALOGS_POINT,
  LAYOUTS_POINT,
  MENUS_POINT,
  NOTIFICATIONS_POINT,
  STATUSBAR_POINT,
  VIEWS_POINT,
} from "./archive.js";
import { type ActivityItem, buildActivitybar, buildStatusbar, type StatusItem } from "./bars.js";
import { WorkbenchError } from "./errors.js";
import {
  commandForKey,
  type KeyEventLike,
  normalizeChord,
  type WorkbenchKeybinding,
} from "./keybindings.js";
import {
  DEVICE_MODES,
  type DeviceMode,
  defaultLayout,
  filterLayout,
  type LayoutContribution,
  layoutKey,
  placeView,
  readSavedLayout,
  toSaved,
  viewsOf,
  type WorkbenchLayout,
  withoutViews,
  type Zone,
  zoneIn,
} from "./layout.js";
import { buildMenu, type MenuNode } from "./menus.js";
import {
  createRequests,
  type DialogRequest,
  dialogRequest,
  type NotificationRequest,
  notificationRequest,
  type Requests,
} from "./requests.js";
import type { WhenContext } from "./when.js";

/** A view contributed to the `views` point, as the workbench lists it. */
export interface ViewEntry {
  /** The view's identity, `<fragment-id>/<view-id>`. */
  readonly id: string;
  /** The view's id within its fragment. */
  readonly viewId: string;
  /** The contributing fragment. */
  readonly fragment: string;
  readonly title: string;
  /** The zone it opens in unless asked otherwise (`center` when it names none). */
  readonly zone: Zone;
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
  /**
   * Follow the surfaces the source drops (deleted by their sender, removed by the host): each
   * leaves the dock. Returns a disposer; the workbench subscribes while the source is set.
   */
  onRemoved?(listener: (surfaceId: string) => void): () => void;
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
  /** The open views of the current device mode, zone by zone (centre, left, right, bottom). */
  readonly opened: readonly string[];
  /** The current device mode. */
  readonly mode: DeviceMode;
  /** The current mode's layout: its live views, per zone, and the active one. */
  readonly layout: WorkbenchLayout;
  /** The dialogs waiting for an answer, oldest first (the client shows the first). */
  readonly dialogs: readonly DialogRequest[];
  /** The notifications waiting for an answer or to be dismissed. */
  readonly notifications: readonly NotificationRequest[];
  readonly docked: readonly DockedSurface[];
}

/** The workbench model: which views exist and which are open. Rendered by `./client`. */
export interface Workbench {
  /** The live views, in the order their extensions are read. */
  views(): readonly ViewEntry[];
  /** The live view `id` (`<fragment-id>/<view-id>`). */
  view(id: string): ViewEntry | undefined;
  /** The open views' identities in the current mode, zone by zone, in tab order. */
  opened(): readonly string[];
  /**
   * Open the view `id` at the end of `zone` (its preferred zone by default) and make it active;
   * a view already open stays where it is. Throws `WorkbenchError`.
   */
  open(id: string, zone?: Zone): void;
  /** Close the view `id`, when open. */
  close(id: string): void;
  /** The current device mode (`desktop` until the host says otherwise). */
  mode(): DeviceMode;
  /** Switch to `mode`: its own layout, saved or default, shows. */
  setMode(mode: DeviceMode): void;
  /**
   * The current mode's layout, live views only: the mode's saved layout, or its default layout
   * (the `layouts` point, after the host's) until the user changes it.
   */
  layout(): WorkbenchLayout;
  /** The zone the open view `id` is in, in the current mode. */
  zoneOf(id: string): Zone | undefined;
  /**
   * Move the view `id` to `zone`, before its `index`-th view (the end by default), opening it
   * if closed. Throws `WorkbenchError`.
   */
  move(id: string, zone: Zone, index?: number): void;
  /** Make the open view `id` the active one. */
  setActive(id: string): void;
  /** Set (or clear) where docked surfaces come from; clearing it empties the dock. */
  setSurfaceSource(source: SurfaceSource | undefined): void;
  /**
   * The menu `menu` (`menubar`, `view/context`, `view/title`, a submenu's id) from the `menus`
   * point, its entries filtered by their `when` against `context`. Static contributions are
   * listed before the contributor's code loads; a command entry shows only while its command is
   * on the bus.
   */
  menu(menu: string, context?: WhenContext): readonly MenuNode[];
  /**
   * The keyboard shortcuts: system.commands' `keybindings` whose command is on the bus, their
   * chords normalized, in the order contributed. Static, so listed before the code loads.
   */
  keybindings(): readonly WorkbenchKeybinding[];
  /** The command a key event runs in `context` (the last matching binding wins), if any. */
  keyCommand(event: KeyEventLike, context?: WhenContext): string | undefined;
  /**
   * The command palette's entries: every command on the bus, titled and described in the
   * locale, with its keybinding, sorted by title.
   */
  palette(): readonly PaletteEntry[];
  /** The status bar's items whose `when` holds in `context`, left then right, by order. */
  statusbar(context?: WhenContext): readonly StatusItem[];
  /** The activity bar's entries whose view or command is live, by order then title. */
  activitybar(): readonly ActivityItem[];
  /** Dialogs declared on the `dialogs` point: raised by fragments, answered by the client. */
  readonly dialogs: Requests<DialogRequest>;
  /** Notifications declared on the `notifications` point. */
  readonly notifications: Requests<NotificationRequest>;
  /**
   * Run the command `id` as the chrome does (menus, palette, keybindings): a failure raises
   * system.workbench's `command-failed` notification instead of rejecting.
   */
  execute(id: string): Promise<void>;
  /** Run the command `id` through system.commands' bus, with no input unless given. */
  run<T = unknown>(id: string, input?: unknown): Promise<T>;
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
   * the open views, the dock, the chrome's points or the commands. Returns a disposer.
   */
  observe(listener: (state: WorkbenchState) => void): () => void;
}

/** One command as the palette lists it. */
export interface PaletteEntry {
  /** The command's identity, `<fragment-id>/<command-id>`. */
  readonly command: string;
  readonly title: string;
  readonly description: string;
  readonly keybinding?: string;
  /** The contributing fragment. */
  readonly fragment: string;
}

/**
 * Where the workbench keeps its layouts: system.profile's store (a synchronous key-value store of
 * JSON values, local to the device). Layouts go under `layoutKey(mode)`.
 */
export interface LayoutStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

/** How the workbench is wired: the command bus its chrome runs commands on, and its locale. */
export interface SystemWorkbenchOptions {
  /** Where layouts are saved; without one they last as long as the workbench. */
  readonly profile?: LayoutStore;
  /** The device mode to start in; `desktop` by default. */
  readonly mode?: DeviceMode;
  /**
   * The host's default layouts (an application definition's), before the `layouts` point's.
   */
  readonly layouts?: readonly LayoutContribution[];
  /** system.commands' bus. Without one, menus list no commands and `run` fails. */
  readonly commands?: CommandBus;
  /** The locale commands are titled in (`fr-FR`); their default labels otherwise. */
  readonly locale?: string;
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
  readonly zone?: Zone;
}

function entryOf(extension: Extension): ViewEntry {
  const data = extension.data as ViewData;
  const id = `${extension.contributor}/${data.id}`;
  return {
    id,
    viewId: data.id,
    fragment: extension.contributor,
    title: data.title,
    zone: data.zone ?? "center",
    extension,
    async component<T>() {
      if (!extension.reference) throw new WorkbenchError("no-component", id);
      return extension.reference.resolve<T>();
    },
  };
}

/**
 * Whether a command needs an input: its request body is required, or its input schema requires
 * properties. The chrome runs commands with no input, so it offers only those that need none.
 */
export function needsInput(entry: CommandEntry): boolean {
  const body = entry.operation.requestBody as { readonly required?: unknown } | undefined;
  if (body?.required === true) return true;
  const input = entry.input;
  if (typeof input !== "object" || input === null) return false;
  const required = (input as { required?: unknown }).required;
  return Array.isArray(required) && required.length > 0;
}

/** The prefix of a docked surface's panel id. */
export const SURFACE_PANEL_PREFIX = "surface:";

export function createSystemWorkbench(options: SystemWorkbenchOptions = {}): SystemWorkbench {
  const { commands, locale, profile } = options;
  /** A live command the chrome can run: on the bus, needing no input. */
  const runnable = (id: string): CommandEntry | undefined => {
    const entry = commands?.get(id);
    return entry && !needsInput(entry) ? entry : undefined;
  };
  let views: readonly ViewEntry[] = [];
  /** The live extensions of the chrome's points (every point but `views`), by point. */
  const points = new Map<string, readonly Extension[]>();
  const read = (point: string) => points.get(point) ?? [];
  let mode: DeviceMode = options.mode ?? "desktop";
  /** The layouts the user changed, per mode, as saved: may name views not there (yet). */
  const saved = new Map<DeviceMode, WorkbenchLayout | undefined>();
  let docked: readonly DockedSurface[] = [];
  let source: SurfaceSource | undefined;
  let unfollow: (() => void) | undefined;
  const listeners = new Set<(state: WorkbenchState) => void>();
  const isLive = (id: string) => views.some((v) => v.id === id);
  /** A mode's saved layout, read from the profile once. */
  function savedLayout(of: DeviceMode): WorkbenchLayout | undefined {
    if (!saved.has(of)) {
      let value: unknown;
      try {
        value = profile?.get(layoutKey(of));
      } catch (error) {
        console.error("[system.workbench] the profile threw:", error);
      }
      saved.set(of, readSavedLayout(value));
    }
    return saved.get(of);
  }
  /** A mode's layout as kept: saved, or the default one. */
  const rawLayout = (of: DeviceMode): WorkbenchLayout =>
    savedLayout(of) ??
    defaultLayout(of, [
      ...(options.layouts ?? []),
      ...read(LAYOUTS_POINT).map((e) => e.data as LayoutContribution),
    ]);
  const currentLayout = () => filterLayout(rawLayout(mode), isLive);
  /** Keep `layout` as `of`'s saved layout, in the profile too. */
  function save(of: DeviceMode, layout: WorkbenchLayout) {
    saved.set(of, layout);
    try {
      profile?.set(layoutKey(of), toSaved(layout));
    } catch (error) {
      console.error("[system.workbench] the layout was not saved:", error);
    }
  }
  /** Change the current mode's layout (the change saves it), and tell the listeners. */
  function change(next: (layout: WorkbenchLayout) => WorkbenchLayout) {
    save(mode, next(rawLayout(mode)));
    notify();
  }
  const opened = () => viewsOf(currentLayout());
  const state = (): WorkbenchState => ({
    views,
    opened: opened(),
    mode,
    layout: currentLayout(),
    dialogs: dialogs.pending(),
    notifications: notifications.pending(),
    docked,
  });
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

  const dialogs = createRequests(
    "unknown-dialog",
    () => read(DIALOGS_POINT),
    dialogRequest,
    () => notify(),
  );
  const notifications = createRequests(
    "unknown-notification",
    () => read(NOTIFICATIONS_POINT),
    notificationRequest,
    () => notify(),
  );

  /** Dismiss the requests of fragments no longer contributing to their point. */
  function dropLeft() {
    const from = (point: string) => new Set(read(point).map((e) => e.contributor));
    const declaringDialogs = from(DIALOGS_POINT);
    const declaringNotifications = from(NOTIFICATIONS_POINT);
    dialogs.drop((f) => declaringDialogs.has(f));
    notifications.drop((f) => declaringNotifications.has(f));
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

  /**
   * The live views are those of `extensions`, the first per identity winning. The views that
   * leave (their fragment disabled or removed) leave every saved layout too.
   */
  function sync(extensions: readonly Extension[]) {
    const next = new Map<string, ViewEntry>();
    for (const extension of extensions) {
      const entry = entryOf(extension);
      if (!next.has(entry.id)) next.set(entry.id, entry);
    }
    const left = new Set(views.filter((v) => !next.has(v.id)).map((v) => v.id));
    views = [...next.values()];
    if (left.size > 0) {
      for (const of of DEVICE_MODES) {
        const layout = savedLayout(of);
        if (layout && viewsOf(layout).some((id) => left.has(id))) {
          save(
            of,
            withoutViews(layout, (id) => left.has(id)),
          );
        }
      }
    }
    notify();
  }

  const workbench: Workbench = {
    views: () => views,
    view: (id) => views.find((v) => v.id === id),
    opened,
    open(id, zone) {
      const view = workbench.view(id);
      if (!view) throw new WorkbenchError("unknown-view", id);
      const at = zoneIn(currentLayout(), id);
      if (at !== undefined) {
        if (zone !== undefined && zone !== at) workbench.move(id, zone);
        return;
      }
      change((layout) => ({ ...placeView(layout, id, zone ?? view.zone, isLive), active: id }));
    },
    close(id) {
      const current = currentLayout();
      if (zoneIn(current, id) === undefined) return;
      change((layout) => {
        const rest = withoutViews(layout, (v) => v === id);
        if (current.active !== id) return rest;
        const next = viewsOf(filterLayout(rest, isLive))[0];
        return next === undefined ? rest : { ...rest, active: next };
      });
    },
    mode: () => mode,
    setMode(next) {
      if (next === mode) return;
      mode = next;
      notify();
    },
    layout: currentLayout,
    zoneOf: (id) => zoneIn(currentLayout(), id),
    move(id, zone, index) {
      if (!workbench.view(id)) throw new WorkbenchError("unknown-view", id);
      const current = currentLayout();
      if (zoneIn(current, id) === zone && index === undefined) return;
      const opening = zoneIn(current, id) === undefined;
      change((layout) => {
        const placed = placeView(layout, id, zone, isLive, index);
        return opening ? { ...placed, active: id } : placed;
      });
    },
    setActive(id) {
      const current = currentLayout();
      if (current.active === id || zoneIn(current, id) === undefined) return;
      change((layout) => ({ ...layout, active: id }));
    },
    menu(menu, context = {}) {
      return buildMenu(menu, read(MENUS_POINT), menuCommands, context);
    },
    keybindings,
    palette() {
      if (!commands) return [];
      const bound = keybindings();
      return commands
        .list()
        .filter((entry) => !needsInput(entry))
        .map((entry): PaletteEntry => {
          const { title, description } = labelsOf(entry, locale);
          const keybinding = bound.find((k) => k.command === entry.id)?.key;
          return {
            command: entry.id,
            title,
            description,
            ...(keybinding ? { keybinding } : {}),
            fragment: entry.fragment,
          };
        })
        .sort((a, b) => a.title.localeCompare(b.title, locale));
    },
    keyCommand: (event, context) => commandForKey(keybindings(), event, context),
    statusbar: (context = {}) =>
      buildStatusbar(read(STATUSBAR_POINT), (id) => runnable(id) !== undefined, context),
    activitybar: () =>
      buildActivitybar(
        read(ACTIVITYBAR_POINT),
        (id) => workbench.view(id) !== undefined,
        (id) => runnable(id) !== undefined,
      ),
    dialogs,
    notifications,
    async execute(id) {
      try {
        await workbench.run(id);
      } catch (error) {
        const reason = error instanceof Error ? error : new Error(String(error));
        const cause = reason.cause instanceof Error ? `: ${reason.cause.message}` : "";
        void notifications
          .show(COMMAND_FAILED_NOTIFICATION, {
            command: titleOf(id) ?? id,
            error: `${reason.message}${cause}`,
          })
          .catch(() => undefined);
      }
    },
    async run<T>(id: string, input?: unknown): Promise<T> {
      if (!commands) throw new WorkbenchError("no-commands", id);
      return commands.call<T>(id, input);
    },
    setSurfaceSource(next) {
      if (source === next) return;
      unfollow?.();
      unfollow = undefined;
      undockAll();
      source = next;
      unfollow = next?.onRemoved?.((surfaceId) => workbench.closeSurface(surfaceId));
    },
    openSurface(surfaceId, options = {}) {
      const title = source?.title(surfaceId);
      if (!source || title === undefined) throw new WorkbenchError("unknown-surface", surfaceId);
      if (docked.some((d) => d.surfaceId === surfaceId)) {
        tell(surfaceId, true); // keep the source's placement in step with the dock
        return;
      }
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

  function keybindings(): WorkbenchKeybinding[] {
    if (!commands) return [];
    return commands
      .keybindings()
      .filter((k) => runnable(k.command) !== undefined)
      .map(({ key, command, when, fragment }) => ({
        key: normalizeChord(key),
        command,
        ...(when !== undefined ? { when } : {}),
        fragment,
      }));
  }

  /** A live command's title in the locale. */
  function titleOf(id: string): string | undefined {
    const entry = commands?.get(id);
    return entry ? labelsOf(entry, locale).title : undefined;
  }

  const menuCommands = {
    title: (command: string) => (runnable(command) ? titleOf(command) : undefined),
    keybinding(command: string) {
      return keybindings().find((k) => k.command === command)?.key;
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
      const stops = [context.extensions.observe(VIEWS_POINT, (all) => sync(all))];
      for (const point of context.extensions.names) {
        if (point === VIEWS_POINT) continue;
        stops.push(
          context.extensions.observe(point, (all) => {
            points.set(point, all);
            dropLeft();
            notify();
          }),
        );
      }
      // The chrome titles and binds commands: it follows the bus too.
      let first = true;
      if (commands) {
        stops.push(
          commands.observe(() => {
            if (!first) notify();
          }),
        );
      }
      first = false;
      return () => {
        for (const stop of stops) stop();
        points.clear();
        dropLeft();
        views = []; // the saved layouts stay as they are
        undockAll();
        notify();
      };
    },
  };
}
