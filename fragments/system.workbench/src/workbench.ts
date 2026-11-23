import type { ActivationContext, Extension } from "@statewalker/kernel.core";
import { type CommandBus, type CommandEntry, labelsOf } from "@statewalker/system.commands";
import {
  ACTIVITYBAR_POINT,
  COMMAND_FAILED_NOTIFICATION,
  DIALOGS_POINT,
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
  /** The dialogs waiting for an answer, oldest first (the client shows the first). */
  readonly dialogs: readonly DialogRequest[];
  /** The notifications waiting for an answer or to be dismissed. */
  readonly notifications: readonly NotificationRequest[];
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
   * Follow the workbench: `listener` is called at once, then after every change to the views,
   * the open views, the chrome's points or the commands. Returns a disposer.
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

/** How the workbench is wired: the command bus its chrome runs commands on, and its locale. */
export interface SystemWorkbenchOptions {
  /** system.commands' bus. Without one, menus list no commands and `run` fails. */
  readonly commands?: CommandBus;
  /** The locale commands are titled in (`fr-FR`); their default labels otherwise. */
  readonly locale?: string;
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

export function createSystemWorkbench(options: SystemWorkbenchOptions = {}): SystemWorkbench {
  const { commands, locale } = options;
  /** A live command the chrome can run: on the bus, needing no input. */
  const runnable = (id: string): CommandEntry | undefined => {
    const entry = commands?.get(id);
    return entry && !needsInput(entry) ? entry : undefined;
  };
  let views: readonly ViewEntry[] = [];
  /** The live extensions of the chrome's points (every point but `views`), by point. */
  const points = new Map<string, readonly Extension[]>();
  const read = (point: string) => points.get(point) ?? [];
  let opened: readonly string[] = [];
  const listeners = new Set<(state: WorkbenchState) => void>();
  const state = (): WorkbenchState => ({
    views,
    opened,
    dialogs: dialogs.pending(),
    notifications: notifications.pending(),
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

  return {
    workbench,
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
        views = [];
        opened = [];
        notify();
      };
    },
  };
}
