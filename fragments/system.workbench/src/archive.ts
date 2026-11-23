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
  },
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
  },
  extensions: [
    command("open-surface", "Pop a surface out into the workbench's dock", true, "openSurface"),
    command("close-surface", "Take a surface out of the dock", false, "closeSurface"),
  ],
};

/** The fragment's archive, as the kernel takes it (`createKernel({ core: [...] })`). */
export const systemWorkbenchArchive: FragmentFiles = Object.freeze({
  "fragment.jsonc": `${JSON.stringify(fragmentManifest, null, 2)}\n`,
  "fragment.client.jsonc": `${JSON.stringify(clientAspect, null, 2)}\n`,
});
