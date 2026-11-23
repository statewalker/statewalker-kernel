// The fragment's own files. `fragment.jsonc` and `fragment.client.jsonc` at the package root are
// the same documents as written on disk (a test keeps them equal), so the folder is the fragment
// and the host gets its archive without reading files.
import type { FragmentFiles } from "@statewalker/kernel.core";

/** The fragment's id (a core fragment: the reserved `system.` prefix). */
export const SYSTEM_SETTINGS_ID = "system.settings";

/** The short id of the point settings schemas are contributed on. */
export const SETTINGS_POINT = "settings";

/** The settings view's identity on system.workbench's `views` point. */
export const SETTINGS_VIEW = `${SYSTEM_SETTINGS_ID}/settings`;

/** A setting's key: a letter, then letters, digits, `_`, `-` or `.`; at most 64 characters. */
export const SETTING_KEY_PATTERN = "^[A-Za-z][A-Za-z0-9_.-]*$";

const KERNEL_SCHEMAS = "./node_modules/@statewalker/kernel.core/schemas";

const text = (maxLength: number) => ({ type: "string", minLength: 1, maxLength }) as const;

/**
 * One setting: a JSON Schema 2020-12 of a string, a number, an integer or a boolean, with the
 * keywords the settings view renders and the model validates (`enum` makes a choice).
 */
export const settingSchema = {
  type: "object",
  required: ["type"],
  additionalProperties: false,
  properties: {
    type: { enum: ["string", "number", "integer", "boolean"] },
    title: { description: "The setting's label in the settings view.", ...text(128) },
    description: { description: "A line under the label.", ...text(512) },
    default: {
      description: "The value while the user has set none.",
      type: ["string", "number", "boolean"],
    },
    enum: {
      description: "The values to choose from.",
      type: "array",
      minItems: 1,
      maxItems: 64,
      uniqueItems: true,
      items: { type: ["string", "number"] },
    },
    minimum: { type: "number" },
    maximum: { type: "number" },
    minLength: { type: "integer", minimum: 0 },
    maxLength: { type: "integer", minimum: 0 },
    pattern: { type: "string", maxLength: 512 },
  },
} as const;

/**
 * The data of an extension to `settings`: the contributing fragment's settings page, its title
 * and its settings as a JSON Schema 2020-12 object. One page per fragment (the first extension
 * read wins); its values are the fragment's own, kept in the user's profile.
 */
export const settingsPageSchema = {
  type: "object",
  required: ["schema"],
  additionalProperties: false,
  properties: {
    title: {
      description: "The page's title; the fragment's name by default.",
      ...text(128),
    },
    description: { ...text(512) },
    order: {
      description: "Pages are sorted by order (0 by default), then title.",
      type: "number",
    },
    schema: {
      description: "The settings: a JSON Schema 2020-12 object whose properties are the settings.",
      type: "object",
      required: ["type", "properties"],
      additionalProperties: false,
      properties: {
        $schema: { const: "https://json-schema.org/draft/2020-12/schema" },
        type: { const: "object" },
        properties: {
          type: "object",
          maxProperties: 64,
          propertyNames: { pattern: SETTING_KEY_PATTERN, maxLength: 64 },
          additionalProperties: settingSchema,
        },
      },
    },
  },
} as const;

export const fragmentManifest = {
  $schema: `${KERNEL_SCHEMAS}/fragment.v1.schema.json`,
  id: SYSTEM_SETTINGS_ID,
  version: "0.1.0",
  name: "Settings",
  description:
    "Every fragment's settings in one settings view; the values kept in the user's profile.",
  engines: { platform: "*" },
  aspects: { client: {} },
};

/**
 * The client aspect: the `settings` point, and the settings view with its activity bar entry
 * (on system.workbench's points; dormant without it). The view's component is the fragment's
 * client module export `SettingsView`, which the host resolves in process.
 */
export const clientAspect = {
  $schema: `${KERNEL_SCHEMAS}/fragment-aspect.v1.schema.json`,
  extensionPoints: {
    [SETTINGS_POINT]: {
      description: "A fragment's settings page: its settings as a JSON Schema, values per device.",
      schema: settingsPageSchema,
    },
  },
  extensions: [
    {
      point: "views",
      data: { id: "settings", title: "Settings" },
      reference: { module: "./index.js", export: "SettingsView" },
    },
    {
      point: "activitybar",
      data: { id: "settings", title: "Settings", order: 1000, view: SETTINGS_VIEW },
    },
  ],
};

/** The fragment's archive, as the kernel takes it (`createKernel({ core: [...] })`). */
export const systemSettingsArchive: FragmentFiles = Object.freeze({
  "fragment.jsonc": `${JSON.stringify(fragmentManifest, null, 2)}\n`,
  "fragment.client.jsonc": `${JSON.stringify(clientAspect, null, 2)}\n`,
});
