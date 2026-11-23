// The fragment's own files. `fragment.jsonc` and `fragment.client.jsonc` at the package root are
// the same documents as written on disk (a test keeps them equal), so the folder is the fragment
// and the host gets its archive without reading files.
import type { FragmentFiles } from "@statewalker/kernel.core";

/** The fragment's id (a core fragment: the reserved `system.` prefix). */
export const SYSTEM_SECURITY_ID = "system.security";

/** The short id of the point standing grants are declared on. */
export const CAPABILITIES_POINT = "capabilities";

/** A permission to call one command: `tools.use:<fragment-id>/<command-id>`. */
export const PERMISSION_PATTERN = "^tools\\.use:[a-z][a-z0-9.-]*/[a-z][a-z0-9]*(-[a-z0-9]+)*$";

const KERNEL_SCHEMAS = "./node_modules/@statewalker/kernel.core/schemas";

/**
 * The data of an extension to `capabilities`: a standing grant of these permissions to every
 * principal of these kinds. Only system code (a `system.` fragment) may contribute one; any other
 * contribution is refused and grants nothing.
 */
export const capabilitySchema = {
  type: "object",
  required: ["principals", "permissions"],
  additionalProperties: false,
  properties: {
    principals: {
      description: "The kinds of principal granted the permissions.",
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { enum: ["agent", "peer", "sandbox"] },
    },
    permissions: {
      description: "The permissions granted, each `tools.use:<fragment-id>/<command-id>`.",
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", pattern: PERMISSION_PATTERN },
    },
    description: { description: "Why the grant exists, shown with it.", type: "string" },
  },
} as const;

export const fragmentManifest = {
  $schema: `${KERNEL_SCHEMAS}/fragment.v1.schema.json`,
  id: SYSTEM_SECURITY_ID,
  version: "0.1.0",
  name: "Security",
  description:
    "Principals, the capabilities only system code issues, deny-by-default grants, and the user's Allow/Ask/Block policy.",
  engines: { platform: "*" },
  aspects: { client: {} },
};

export const clientAspect = {
  $schema: `${KERNEL_SCHEMAS}/fragment-aspect.v1.schema.json`,
  extensionPoints: {
    [CAPABILITIES_POINT]: {
      description: "Standing grants to kinds of principal; system code only.",
      schema: capabilitySchema,
    },
  },
};

/** The fragment's archive, as the kernel takes it (`createKernel({ core: [...] })`). */
export const systemSecurityArchive: FragmentFiles = Object.freeze({
  "fragment.jsonc": `${JSON.stringify(fragmentManifest, null, 2)}\n`,
  "fragment.client.jsonc": `${JSON.stringify(clientAspect, null, 2)}\n`,
});
