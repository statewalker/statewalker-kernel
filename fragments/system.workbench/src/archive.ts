// The fragment's own files. `fragment.jsonc` and `fragment.client.jsonc` at the package root are
// the same documents as written on disk (a test keeps them equal), so the folder is the fragment
// and the host gets its archive without reading files.
import type { FragmentFiles } from "@statewalker/kernel.core";

/** The fragment's id (a core fragment: the reserved `system.` prefix). */
export const SYSTEM_WORKBENCH_ID = "system.workbench";

/** The short id of the point views are contributed on. */
export const VIEWS_POINT = "views";

/** A view id: lowercase letters and digits, inner hyphens, at most 64 characters. */
export const VIEW_ID_PATTERN = "^[a-z][a-z0-9]*(-[a-z0-9]+)*$";

/** The short id of the point default layouts are contributed on. */
export const LAYOUTS_POINT = "layouts";

/** The workbench's zones and device modes, as the points' schemas name them. */
const ZONE_NAMES = ["center", "left", "right", "bottom"] as const;
const MODE_NAMES = ["phone", "tablet", "desktop"] as const;

/** A view's identity, `<fragment-id>/<view-id>`. */
export const VIEW_IDENTITY_PATTERN = "^[a-z][a-z0-9.-]*/[a-z][a-z0-9]*(-[a-z0-9]+)*$";

/** The short id of the point menu entries are contributed on. */
export const MENUS_POINT = "menus";

/** A menu id: `menubar`, `view/context`, `view/title`, or a submenu's id (`notes`, `org.x.tools`). */
export const MENU_ID_PATTERN = "^[a-z][a-z0-9.-]*(/[a-z][a-z0-9.-]*)*$";

/** A command's identity, `<fragment-id>/<command-id>` (as system.commands' keybindings name it). */
export const COMMAND_ID_PATTERN = "^[a-z][a-z0-9.-]*/[a-z][a-z0-9-]*$";

/** The short ids of the points dialogs and notifications are declared on. */
export const DIALOGS_POINT = "dialogs";
export const NOTIFICATIONS_POINT = "notifications";

/** The short ids of the status bar's and the activity bar's points. */
export const STATUSBAR_POINT = "statusbar";
export const ACTIVITYBAR_POINT = "activitybar";

/** The notification system.workbench raises when a command run from its chrome fails. */
export const COMMAND_FAILED_NOTIFICATION = "system.workbench/command-failed";

const KERNEL_SCHEMAS = "./node_modules/@statewalker/kernel.core/schemas";

/**
 * The data of an extension to `views`: one view, its id unique within the contributing
 * fragment, and its title. The view's component is the extension's lazy reference (a client
 * module export).
 */
export const viewSchema = {
  type: "object",
  required: ["id", "title"],
  additionalProperties: false,
  properties: {
    id: {
      description: "The view's id within its fragment; its identity is `<fragment-id>/<id>`.",
      type: "string",
      pattern: VIEW_ID_PATTERN,
      maxLength: 64,
    },
    title: { description: "The title its tab shows.", type: "string", minLength: 1 },
    zone: {
      description: "The zone it opens in unless asked otherwise; the centre by default.",
      enum: ZONE_NAMES,
    },
  },
} as const;

/**
 * The data of an extension to `layouts`: a default layout, the views each zone opens with, for
 * one device mode or (without `mode`) for every mode. A mode's default layout is every
 * contribution for it, in order; it applies until the user changes that mode's layout.
 */
export const layoutSchema = {
  type: "object",
  required: ["zones"],
  additionalProperties: false,
  properties: {
    mode: {
      description: "The device mode it is for; every mode when absent.",
      enum: MODE_NAMES,
    },
    zones: {
      description: "The views (`<fragment-id>/<view-id>`) each zone opens with, in tab order.",
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        ZONE_NAMES.map((zone) => [
          zone,
          {
            type: "array",
            uniqueItems: true,
            items: { type: "string", pattern: VIEW_IDENTITY_PATTERN },
          },
        ]),
      ),
    },
    active: {
      description: "The view in front (on a phone, the one shown).",
      type: "string",
      pattern: VIEW_IDENTITY_PATTERN,
    },
  },
} as const;

/**
 * The data of an extension to `menus`: one entry of the menu `menu`, either a command (titled by
 * the command's label unless `title` is given) or a submenu (`submenu` names the menu it opens).
 * Entries are sorted by `group` (separated), then `order`, then title; `when` is a context
 * expression (`view == org.x/notes && !inputFocus`).
 */
export const menuSchema = {
  type: "object",
  required: ["menu"],
  additionalProperties: false,
  properties: {
    menu: {
      description:
        "The menu the entry is in: `menubar` (its entries are submenus), `view/context` (a view's context menu), `view/title` (a view's tab menu), or a submenu's id.",
      type: "string",
      pattern: MENU_ID_PATTERN,
      maxLength: 128,
    },
    command: {
      description: "The command the entry runs, `<fragment-id>/<command-id>`.",
      type: "string",
      pattern: COMMAND_ID_PATTERN,
    },
    submenu: {
      description: "The id of the menu the entry opens; with `title`.",
      type: "string",
      pattern: MENU_ID_PATTERN,
      maxLength: 128,
    },
    title: {
      description: "The entry's title; a command's label by default.",
      type: "string",
      minLength: 1,
    },
    group: {
      description: "Entries of one group sit together, groups in name order, separated.",
      type: "string",
    },
    order: { description: "The entry's place in its group (0 by default).", type: "number" },
    when: {
      description: "A context expression; the entry shows only where it holds.",
      type: "string",
    },
  },
  oneOf: [{ required: ["command"] }, { required: ["submenu", "title"] }],
} as const;

/** An id within the declaring fragment, as views have. */
const localId = (what: string) => ({
  description: `The ${what}'s id within its fragment; its identity is \`<fragment-id>/<id>\`.`,
  type: "string",
  pattern: VIEW_ID_PATTERN,
  maxLength: 64,
});

const text = (description: string) => ({ description, type: "string", minLength: 1 }) as const;

/** The buttons of a dialog or a notification; the id picked is the answer's `action`. */
const actionsSchema = {
  description: "The buttons, in order; the one picked is the answer's `action`.",
  type: "array",
  minItems: 1,
  items: {
    type: "object",
    required: ["id", "label"],
    additionalProperties: false,
    properties: {
      id: { type: "string", pattern: VIEW_ID_PATTERN, maxLength: 64 },
      label: text("The button's text."),
      primary: { description: "The default button.", type: "boolean" },
    },
  },
} as const;

/**
 * The data of an extension to `dialogs`: a dialog a fragment raises by identity (the client
 * API's `dialogs.show(id, params)`), shown the same way for every fragment. Its texts may name
 * params as `{name}`. The answer is the action picked and, with `input`, the text typed.
 */
export const dialogSchema = {
  type: "object",
  required: ["id", "title"],
  additionalProperties: false,
  properties: {
    id: localId("dialog"),
    title: text("The dialog's title."),
    message: { description: "The text under the title.", type: "string" },
    input: {
      description: "A text field; what the user typed is the answer's `value`.",
      type: "object",
      required: ["label"],
      additionalProperties: false,
      properties: {
        label: text("The field's label."),
        placeholder: { type: "string" },
        value: { description: "The field's initial text.", type: "string" },
      },
    },
    actions: {
      ...actionsSchema,
      description: `${actionsSchema.description} One OK button when absent.`,
    },
  },
} as const;

/**
 * The data of an extension to `notifications`: a notification a fragment raises by identity
 * (the client API's `notifications.show(id, params)`), shown the same way for every fragment.
 * The answer is the action picked, or none when it is dismissed.
 */
export const notificationSchema = {
  type: "object",
  required: ["id", "title"],
  additionalProperties: false,
  properties: {
    id: localId("notification"),
    title: text("The notification's text."),
    message: { description: "A second line.", type: "string" },
    severity: { enum: ["info", "success", "warning", "error"], default: "info" },
    actions: actionsSchema,
  },
} as const;

/**
 * The data of an extension to `statusbar`: a text in the status bar, on the left by default,
 * running `command` when clicked. `when` is a context expression.
 */
export const statusItemSchema = {
  type: "object",
  required: ["id", "text"],
  additionalProperties: false,
  properties: {
    id: localId("item"),
    text: text("What the item shows."),
    tooltip: { type: "string" },
    alignment: { enum: ["left", "right"], default: "left" },
    order: { description: "Its place on its side (0 by default).", type: "number" },
    command: {
      description: "The command a click runs.",
      type: "string",
      pattern: COMMAND_ID_PATTERN,
    },
    when: {
      description: "A context expression; the item shows only where it holds.",
      type: "string",
    },
  },
} as const;

/**
 * The data of an extension to `activitybar`: an entry of the activity bar that opens a view
 * (`<fragment-id>/<view-id>`) or runs a command.
 */
export const activityItemSchema = {
  type: "object",
  required: ["id", "title"],
  additionalProperties: false,
  properties: {
    id: localId("entry"),
    title: text("The entry's title (its tooltip and accessible name)."),
    order: { description: "Its place in the bar (0 by default).", type: "number" },
    view: {
      description: "The view it opens, `<fragment-id>/<view-id>`.",
      type: "string",
      pattern: "^[a-z][a-z0-9.-]*/[a-z][a-z0-9-]*$",
    },
    command: {
      description: "The command it runs.",
      type: "string",
      pattern: COMMAND_ID_PATTERN,
    },
  },
  oneOf: [{ required: ["view"] }, { required: ["command"] }],
} as const;

export const fragmentManifest = {
  $schema: `${KERNEL_SCHEMAS}/fragment.v1.schema.json`,
  id: SYSTEM_WORKBENCH_ID,
  version: "0.1.0",
  name: "Workbench",
  description: "The workbench: views contributed by fragments, shown in one dockview.",
  engines: { platform: "*" },
  aspects: { client: {} },
};

/** The input of `open-surface`: the surface, and the title its tab shows. */
const surfaceInput = (withTitle: boolean) => ({
  type: "object",
  required: ["surfaceId"],
  additionalProperties: false,
  properties: {
    surfaceId: { type: "string", minLength: 1, maxLength: 256 },
    ...(withTitle ? { title: { type: "string", minLength: 1, maxLength: 256 } } : {}),
  },
});

/** A command of the workbench's own, its handler an export of the fragment's client module. */
const command = (operationId: string, summary: string, withTitle: boolean, handler: string) => ({
  point: "commands",
  data: {
    operation: {
      operationId,
      summary,
      requestBody: { content: { "application/json": { schema: surfaceInput(withTitle) } } },
      responses: {
        "200": {
          description: "Done",
          content: {
            "application/json": { schema: { type: "object", additionalProperties: false } },
          },
        },
      },
    },
  },
  reference: { module: "./index.js", export: handler },
});

export const clientAspect = {
  $schema: `${KERNEL_SCHEMAS}/fragment-aspect.v1.schema.json`,
  extensionPoints: {
    [VIEWS_POINT]: {
      description: "Views the workbench shows, each a React component (the lazy reference).",
      schema: viewSchema,
    },
    [LAYOUTS_POINT]: {
      description: "Default layouts: the views each zone opens with, per device mode.",
      schema: layoutSchema,
    },
    [MENUS_POINT]: {
      description:
        "Entries of the menu bar, context menus and submenus, each a command or a submenu.",
      schema: menuSchema,
    },
    [NOTIFICATIONS_POINT]: {
      description: "Notifications fragments raise by identity; the answer is the action picked.",
      schema: notificationSchema,
    },
    [DIALOGS_POINT]: {
      description:
        "Dialogs fragments raise by identity; the answer is the action picked and the text typed.",
      schema: dialogSchema,
    },
    [STATUSBAR_POINT]: {
      description: "Items of the status bar, each a text, optionally running a command.",
      schema: statusItemSchema,
    },
    [ACTIVITYBAR_POINT]: {
      description: "Entries of the activity bar, each opening a view or running a command.",
      schema: activityItemSchema,
    },
  },
  extensions: [
    {
      point: NOTIFICATIONS_POINT,
      data: {
        id: "command-failed",
        title: "{command} failed",
        message: "{error}",
        severity: "error",
      },
    },
    command("open-surface", "Pop a surface out into the workbench's dock", true, "openSurface"),
    command("close-surface", "Take a surface out of the dock", false, "closeSurface"),
  ],
};

/** The fragment's archive, as the kernel takes it (`createKernel({ core: [...] })`). */
export const systemWorkbenchArchive: FragmentFiles = Object.freeze({
  "fragment.jsonc": `${JSON.stringify(fragmentManifest, null, 2)}\n`,
  "fragment.client.jsonc": `${JSON.stringify(clientAspect, null, 2)}\n`,
});
