// The fragment's own files. `fragment.jsonc` and `fragment.client.jsonc` at the package root are
// the same documents as written on disk (a test keeps them equal), so the folder is the fragment
// and the host gets its archive without reading files.
import type { FragmentFiles } from "@statewalker/kernel.core";

/** The fragment's id (a core fragment: the reserved `system.` prefix). */
export const SYSTEM_COMMANDS_ID = "system.commands";

/** The short id of the point commands are declared on. */
export const COMMANDS_POINT = "commands";

/** The short id of the point keybindings are declared on. */
export const KEYBINDINGS_POINT = "keybindings";

/** A command id: lowercase letters and digits, inner hyphens, at most 64 characters. */
export const COMMAND_ID_PATTERN = "^[a-z][a-z0-9]*(-[a-z0-9]+)*$";

const KERNEL_SCHEMAS = "./node_modules/@statewalker/kernel.core/schemas";

const jsonSchema = { type: "object" } as const;

/**
 * The data of an extension to `commands`: one command, declared as an OpenAPI 3.1 operation
 * object, with its opt-in exposures and localized labels. The handler is the extension's lazy
 * reference.
 */
export const commandSchema = {
  type: "object",
  required: ["operation"],
  additionalProperties: false,
  properties: {
    operation: {
      description:
        "The command as an OpenAPI 3.1 operation: operationId is the command id, the JSON request body its input (an object), the 200 JSON response its output, other responses its errors.",
      type: "object",
      required: ["operationId"],
      properties: {
        operationId: { type: "string", pattern: COMMAND_ID_PATTERN, maxLength: 64 },
        summary: { type: "string" },
        description: { type: "string" },
        requestBody: {
          type: "object",
          required: ["content"],
          properties: {
            content: {
              type: "object",
              required: ["application/json"],
              properties: {
                "application/json": {
                  type: "object",
                  required: ["schema"],
                  properties: {
                    schema: {
                      type: "object",
                      required: ["type"],
                      properties: { type: { const: "object" } },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          type: "object",
          propertyNames: { pattern: "^([1-5]([0-9]{2}|XX)|default)$" },
          additionalProperties: {
            type: "object",
            properties: {
              content: {
                type: "object",
                properties: {
                  "application/json": {
                    type: "object",
                    properties: { schema: jsonSchema },
                  },
                },
              },
            },
          },
        },
      },
    },
    exposures: {
      description: "Where the command is offered besides the bus. Internal when absent.",
      type: "object",
      additionalProperties: false,
      properties: {
        agent: {
          description: "A harness tool, with its action kind.",
          type: "object",
          required: ["action"],
          additionalProperties: false,
          properties: { action: { enum: ["read", "write", "admin"] } },
        },
        http: {
          description: "A REST endpoint (POST) at `path`, under the fragment's prefix.",
          type: "object",
          required: ["path"],
          additionalProperties: false,
          properties: { path: { type: "string", pattern: "^/" } },
        },
        mcp: {
          description:
            "An MCP tool. Implies `http`: without one, the command is served at `/commands/<command-id>`.",
          type: "object",
          additionalProperties: false,
        },
      },
    },
    labels: {
      description: "Localized title and description, by locale (`fr`, `fr-CA`).",
      type: "object",
      propertyNames: { pattern: "^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$" },
      additionalProperties: {
        type: "object",
        additionalProperties: false,
        properties: { title: { type: "string" }, description: { type: "string" } },
      },
    },
  },
} as const;

/** The data of an extension to `keybindings`: a key chord that calls a command. */
export const keybindingSchema = {
  type: "object",
  required: ["key", "command"],
  additionalProperties: false,
  properties: {
    key: { description: "The key chord (`ctrl+shift+p`).", type: "string", minLength: 1 },
    command: {
      description: "The command's identity, `<fragment-id>/<command-id>`.",
      type: "string",
      pattern: "^[a-z][a-z0-9.-]*/[a-z][a-z0-9-]*$",
    },
    when: { description: "A context expression, read by the workbench.", type: "string" },
  },
} as const;

export const fragmentManifest = {
  $schema: `${KERNEL_SCHEMAS}/fragment.v1.schema.json`,
  id: SYSTEM_COMMANDS_ID,
  version: "0.1.0",
  name: "Commands",
  description: "The command bus: commands declared as OpenAPI operations, and keybindings.",
  engines: { platform: "*" },
  aspects: { client: {} },
};

export const clientAspect = {
  $schema: `${KERNEL_SCHEMAS}/fragment-aspect.v1.schema.json`,
  extensionPoints: {
    [COMMANDS_POINT]: {
      description: "Commands, each one OpenAPI operation, its handler the lazy reference.",
      schema: commandSchema,
    },
    [KEYBINDINGS_POINT]: {
      description: "Key chords calling commands.",
      schema: keybindingSchema,
    },
  },
};

/** The fragment's archive, as the kernel takes it (`createKernel({ core: [...] })`). */
export const systemCommandsArchive: FragmentFiles = Object.freeze({
  "fragment.jsonc": `${JSON.stringify(fragmentManifest, null, 2)}\n`,
  "fragment.client.jsonc": `${JSON.stringify(clientAspect, null, 2)}\n`,
});
