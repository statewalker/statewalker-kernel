// The fragment's own files. `fragment.jsonc` and `fragment.client.jsonc` at the package root are
// the same documents as written on disk (a test keeps them equal), so the folder is the fragment
// and the host gets its archive without reading files.
import type { FragmentFiles } from "@statewalker/kernel.core";

/** The fragment's id (a core fragment: the reserved `system.` prefix). */
export const SYSTEM_TASKS_ID = "system.tasks";

const KERNEL_SCHEMAS = "./node_modules/@statewalker/kernel.core/schemas";

const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  required,
  additionalProperties: false,
  properties,
});

/** A command of this fragment: an OpenAPI operation, its handler the module export `handler`. */
function command(
  id: string,
  summary: string,
  input: Record<string, unknown>,
  output: Record<string, unknown>,
  handler: string,
  exposures?: Record<string, unknown>,
) {
  return {
    point: "commands",
    data: {
      operation: {
        operationId: id,
        summary,
        requestBody: { content: { "application/json": { schema: input } } },
        responses: {
          200: { description: "ok", content: { "application/json": { schema: output } } },
        },
      },
      ...(exposures ? { exposures } : {}),
    },
    reference: { module: "./index.js", export: handler },
  };
}

const jobEntry = object(
  {
    at: { type: "number" },
    progress: {},
    outcome: { enum: ["done", "error", "cancelled"] },
  },
  ["at", "progress"],
);

export const fragmentManifest = {
  $schema: `${KERNEL_SCHEMAS}/fragment.v1.schema.json`,
  id: SYSTEM_TASKS_ID,
  version: "0.1.0",
  name: "Tasks",
  description:
    "The host's task queue: commands exposed as `task` served from it, and publishing, cancelling and job logs.",
  engines: { platform: "*" },
  aspects: { client: {} },
};

export const clientAspect = {
  $schema: `${KERNEL_SCHEMAS}/fragment-aspect.v1.schema.json`,
  extensions: [
    command(
      "publish",
      "Publish a task; by default wait for its reply",
      object(
        {
          subject: {
            description:
              "The task's subject: `fragments.<fragment-id>.<command-id>` runs that command.",
            type: "string",
            minLength: 1,
            maxLength: 1024,
          },
          payload: { description: "The task's input: JSON, at most 64 KB." },
          wait: {
            description: "Wait for the reply (the default); `false` returns once published.",
            type: "boolean",
          },
        },
        ["subject"],
      ),
      object(
        {
          task: { type: "string" },
          job: { description: "The job log of the attempt that answered.", type: "string" },
          result: {},
          error: { type: "string" },
          cancelled: { type: "boolean" },
        },
        ["task"],
      ),
      "publish",
      { agent: { action: "write" } },
    ),
    command(
      "cancel",
      "Cancel a task: a waiting one is removed, a running one stops",
      object({ task: { type: "string", minLength: 1 } }, ["task"]),
      object({ cancelled: { const: true } }, ["cancelled"]),
      "cancel",
    ),
    command(
      "job",
      "Read a job log, after a stamp, waiting up to wait_ms for an entry",
      object(
        {
          job: { type: "string", minLength: 1 },
          after: { type: "number" },
          wait_ms: { type: "number", minimum: 0, maximum: 60_000 },
        },
        ["job"],
      ),
      object(
        {
          id: { type: "string" },
          task: { type: "string" },
          subscription: { type: "string" },
          entries: { type: "array", items: jobEntry },
        },
        ["id", "task", "subscription", "entries"],
      ),
      "job",
    ),
  ],
};

/** The fragment's archive, as the kernel takes it (`createKernel({ core: [...] })`). */
export const systemTasksArchive: FragmentFiles = Object.freeze({
  "fragment.jsonc": `${JSON.stringify(fragmentManifest, null, 2)}\n`,
  "fragment.client.jsonc": `${JSON.stringify(clientAspect, null, 2)}\n`,
});
