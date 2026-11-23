// The fragment's own files. `fragment.jsonc` and `fragment.client.jsonc` at the package root are
// the same documents as written on disk (a test keeps them equal), so the folder is the fragment
// and the host gets its archive without reading files.
import type { FragmentFiles } from "@statewalker/kernel.core";

/** The fragment's id (a core fragment: the reserved `system.` prefix). */
export const SYSTEM_HOST_ID = "system.host";

/** The short id of the point host services are contributed on. */
export const HOST_SERVICES_POINT = "host-services";

/** The kinds of host service, each one interface of `@statewalker/client.core`. */
export const HOST_SERVICE_KINDS = ["clipboard", "files", "url-state"] as const;

/** A kind of host service: `clipboard`, `files` (the file picker) or `url-state`. */
export type HostServiceKind = (typeof HOST_SERVICE_KINDS)[number];

const KERNEL_SCHEMAS = "./node_modules/@statewalker/kernel.core/schemas";

/**
 * The data of an extension to `host-services`: the kind of service it provides. The service
 * itself is the extension's lazy reference (a client module export implementing the kind's
 * interface).
 */
export const hostServiceSchema = {
  type: "object",
  required: ["service"],
  additionalProperties: false,
  properties: {
    service: {
      description:
        "The service provided: `clipboard` (ClipboardService), `files` (FilePickerService) or `url-state` (UrlStateService).",
      enum: [...HOST_SERVICE_KINDS],
    },
  },
} as const;

export const fragmentManifest = {
  $schema: `${KERNEL_SCHEMAS}/fragment.v1.schema.json`,
  id: SYSTEM_HOST_ID,
  version: "0.1.0",
  name: "Host",
  description: "Host services: the clipboard, the file picker and the URL state.",
  engines: { platform: "*" },
  aspects: { client: {} },
};

export const clientAspect = {
  $schema: `${KERNEL_SCHEMAS}/fragment-aspect.v1.schema.json`,
  extensionPoints: {
    [HOST_SERVICES_POINT]: {
      description:
        "Host services replacing the host's own, each the implementation of one kind (the lazy reference).",
      schema: hostServiceSchema,
    },
  },
};

/** The fragment's archive, as the kernel takes it (`createKernel({ core: [...] })`). */
export const systemHostArchive: FragmentFiles = Object.freeze({
  "fragment.jsonc": `${JSON.stringify(fragmentManifest, null, 2)}\n`,
  "fragment.client.jsonc": `${JSON.stringify(clientAspect, null, 2)}\n`,
});
