// The fragment's own files. `fragment.jsonc` and `fragment.client.jsonc` at the package root are
// the same documents as written on disk (a test keeps them equal), so the folder is the fragment
// and the host gets its archive without reading files.
import type { FragmentFiles } from "@statewalker/kernel.core";
import { COMPONENT_NAME_PATTERN } from "./define-component.js";

/** The fragment's id (a core fragment: the reserved `system.` prefix). */
export const SYSTEM_A2UI_ID = "system.a2ui";

/** The short id of the point catalog components are contributed on. */
export const CATALOG_POINT = "catalog";

const KERNEL_SCHEMAS = "./node_modules/@statewalker/kernel.core/schemas";

/**
 * The data of an extension to `catalog`: the component's name. Its definition (a
 * `defineComponent` result, light: Zod schemas plus a lazy view) is the extension's lazy
 * reference, a client module export.
 */
export const catalogSchema = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: {
    name: {
      description:
        "The component's name in A2UI surfaces (`component`), equal to its definition's name.",
      type: "string",
      pattern: COMPONENT_NAME_PATTERN,
      maxLength: 64,
    },
  },
} as const;

export const fragmentManifest = {
  $schema: `${KERNEL_SCHEMAS}/fragment.v1.schema.json`,
  id: SYSTEM_A2UI_ID,
  version: "0.1.0",
  name: "A2UI surfaces",
  description:
    "Declarative surfaces (A2UI 1.0) from agents and server halves, rendered from the catalog components fragments contribute.",
  engines: { platform: "*" },
  aspects: { client: {} },
};

export const clientAspect = {
  $schema: `${KERNEL_SCHEMAS}/fragment-aspect.v1.schema.json`,
  extensionPoints: {
    [CATALOG_POINT]: {
      description:
        "Catalog components surfaces may place, each a defineComponent definition (the lazy reference).",
      schema: catalogSchema,
    },
  },
};

/** The fragment's archive, as the kernel takes it (`createKernel({ core: [...] })`). */
export const systemA2uiArchive: FragmentFiles = Object.freeze({
  "fragment.jsonc": `${JSON.stringify(fragmentManifest, null, 2)}\n`,
  "fragment.client.jsonc": `${JSON.stringify(clientAspect, null, 2)}\n`,
});
