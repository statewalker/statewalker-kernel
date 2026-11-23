// The fragment's own files. `fragment.jsonc` and `fragment.client.jsonc` at the package root are
// the same documents as written on disk (a test keeps them equal), so the folder is the fragment
// and the host gets its archive without reading files.
import type { FragmentFiles } from "@statewalker/kernel.core";

/** The fragment's id (a core fragment: the reserved `system.` prefix). */
export const SYSTEM_L10N_ID = "system.l10n";

/** The short id of the point message bundles are contributed on. */
export const L10N_POINT = "l10n";

/** The interface language when the host names none, and the language every fallback ends in. */
export const DEFAULT_LOCALE = "en";

/** A BCP 47 language tag as bundles name it: `en`, `fr`, `fr-CA`, `zh-Hant-TW`. */
export const LOCALE_PATTERN = "^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$";

/** A message key: letters, digits, `_`, `.`, `-` and `/` (`views.notes.title`). */
export const KEY_PATTERN = "^[A-Za-z0-9_][A-Za-z0-9_./-]*$";

const KERNEL_SCHEMAS = "./node_modules/@statewalker/kernel.core/schemas";

/**
 * The data of an extension to `l10n`: one message bundle, the texts of one locale in one
 * namespace. The namespace is the contributing fragment's id unless the bundle names another
 * (a language pack translating that fragment's keys).
 */
export const bundleSchema = {
  type: "object",
  required: ["locale", "messages"],
  additionalProperties: false,
  properties: {
    locale: {
      description: "The bundle's language, a BCP 47 tag (`fr`, `fr-CA`).",
      type: "string",
      pattern: LOCALE_PATTERN,
      maxLength: 35,
    },
    namespace: {
      description:
        "The fragment whose keys the bundle translates; the contributor's own by default (a language pack names another).",
      type: "string",
      minLength: 1,
      maxLength: 128,
    },
    messages: {
      description: "The texts by key; `{name}` is filled from the caller's values.",
      type: "object",
      maxProperties: 2000,
      propertyNames: { pattern: KEY_PATTERN, maxLength: 128 },
      additionalProperties: { type: "string", maxLength: 4096 },
    },
  },
} as const;

export const fragmentManifest = {
  $schema: `${KERNEL_SCHEMAS}/fragment.v1.schema.json`,
  id: SYSTEM_L10N_ID,
  version: "0.1.0",
  name: "Localization",
  description:
    "Message bundles per locale, namespaced per fragment, and the interface language, switched live.",
  engines: { platform: "*" },
  aspects: { client: {} },
};

export const clientAspect = {
  $schema: `${KERNEL_SCHEMAS}/fragment-aspect.v1.schema.json`,
  extensionPoints: {
    [L10N_POINT]: {
      description:
        "Message bundles: a locale's texts for a fragment's keys (its own, or another's in a language pack).",
      schema: bundleSchema,
    },
  },
  extensions: [
    {
      point: L10N_POINT,
      data: {
        locale: "fr",
        messages: { "picker.label": "Langue" },
      },
    },
  ],
};

/** The fragment's archive, as the kernel takes it (`createKernel({ core: [...] })`). */
export const systemL10nArchive: FragmentFiles = Object.freeze({
  "fragment.jsonc": `${JSON.stringify(fragmentManifest, null, 2)}\n`,
  "fragment.client.jsonc": `${JSON.stringify(clientAspect, null, 2)}\n`,
});
