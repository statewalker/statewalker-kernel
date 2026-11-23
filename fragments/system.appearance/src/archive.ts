// The fragment's own files. `fragment.jsonc` and `fragment.client.jsonc` at the package root are
// the same documents as written on disk (a test keeps them equal), so the folder is the fragment
// and the host gets its archive without reading files.
import type { FragmentFiles } from "@statewalker/kernel.core";

/** The fragment's id (a core fragment: the reserved `system.` prefix). */
export const SYSTEM_APPEARANCE_ID = "system.appearance";

/** The short id of the point brands are contributed on. */
export const BRANDING_POINT = "branding";

/** The short id of the point themes are contributed on. */
export const THEMES_POINT = "themes";

/** A brand's, a theme's or a token's name: lowercase letters and digits, inner hyphens. */
export const NAME_PATTERN = "^[a-z][a-z0-9]*(-[a-z0-9]+)*$";

/**
 * A token's value: anything a CSS declaration's value holds, except what could end the
 * declaration or its rule (`;`, braces, `<`, `>`, a backslash, quotes, a line break, U+2028,
 * U+2029) or open or close a comment (`/*`, `*\/`), anywhere. A slash or a star alone passes:
 * `oklch(1 0 0 / 10%)`, `calc(2 * 3px)`.
 */
export const TOKEN_VALUE_PATTERN = "^(?:[^;{}<>\\\\\"'\\n\\r\\u2028\\u2029/*]|/(?!\\*)|\\*(?!/))*$";

/** Where a logo may come from: an image data URL, an https URL, or a path on the page's site. */
export const LOGO_PATTERN = "^(data:image/(svg\\+xml|png|jpeg|gif|webp)[;,]|https://|\\./|/)";

const KERNEL_SCHEMAS = "./node_modules/@statewalker/kernel.core/schemas";

/** One mode's shadcn tokens, by name without `--` (`primary`, `card-foreground`, `radius`). */
const tokenSetSchema = {
  type: "object",
  maxProperties: 64,
  propertyNames: { pattern: NAME_PATTERN, maxLength: 64 },
  additionalProperties: {
    type: "string",
    minLength: 1,
    maxLength: 256,
    pattern: TOKEN_VALUE_PATTERN,
  },
} as const;

/** The tokens for the light mode and for the dark one. */
const paletteSchema = {
  type: "object",
  required: ["light", "dark"],
  additionalProperties: false,
  properties: { light: tokenSetSchema, dark: tokenSetSchema },
} as const;

/**
 * The data of an extension to `branding`, and an application's own brand: its name, its logo
 * and its colour tokens in light and dark. Its identity is `<fragment-id>/<id>`.
 */
export const brandSchema = {
  type: "object",
  required: ["id", "name", "tokens"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: NAME_PATTERN, maxLength: 64 },
    name: {
      description: "The application's name, as the page shows it.",
      type: "string",
      minLength: 1,
      maxLength: 64,
    },
    logo: {
      description: "The logo's URL: an image data URL, https, or a path on the page's site.",
      type: "string",
      maxLength: 100000,
      pattern: LOGO_PATTERN,
    },
    tokens: paletteSchema,
  },
} as const;

/**
 * The data of an extension to `themes`: tokens laid over the active brand's while the user has
 * the theme selected. Its identity is `<fragment-id>/<id>`.
 */
export const themeSchema = {
  type: "object",
  required: ["id", "title", "tokens"],
  additionalProperties: false,
  properties: {
    id: { type: "string", pattern: NAME_PATTERN, maxLength: 64 },
    title: {
      description: "The theme's name, as a picker shows it.",
      type: "string",
      minLength: 1,
      maxLength: 64,
    },
    tokens: paletteSchema,
  },
} as const;

export const fragmentManifest = {
  $schema: `${KERNEL_SCHEMAS}/fragment.v1.schema.json`,
  id: SYSTEM_APPEARANCE_ID,
  version: "0.1.0",
  name: "Appearance",
  description: "Branding and themes: the shadcn tokens of the active brand, light and dark.",
  engines: { platform: "*" },
  aspects: { client: {} },
};

export const clientAspect = {
  $schema: `${KERNEL_SCHEMAS}/fragment-aspect.v1.schema.json`,
  extensionPoints: {
    [BRANDING_POINT]: {
      description: "Brands: a name, a logo and the shadcn tokens in light and dark. One is active.",
      schema: brandSchema,
    },
    [THEMES_POINT]: {
      description: "Themes: shadcn tokens in light and dark, laid over the active brand's.",
      schema: themeSchema,
    },
  },
};

/** The fragment's archive, as the kernel takes it (`createKernel({ core: [...] })`). */
export const systemAppearanceArchive: FragmentFiles = Object.freeze({
  "fragment.jsonc": `${JSON.stringify(fragmentManifest, null, 2)}\n`,
  "fragment.client.jsonc": `${JSON.stringify(clientAspect, null, 2)}\n`,
});
