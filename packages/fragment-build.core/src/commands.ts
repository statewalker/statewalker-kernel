import type { CommandConfig, ExposuresConfig, FragmentConfig, JsonSchema } from "./config.js";
import { toJsonSchema } from "./schema.js";

/** The point `system.commands` opens for commands (a core point: its short name). */
export const COMMANDS_POINT = "commands";

/** The OpenAPI 3.1 operation of a command, as `system.commands` reads it. */
export interface GeneratedOperation {
  readonly operationId: string;
  readonly summary?: string;
  readonly description?: string;
  readonly requestBody?: {
    readonly required: true;
    readonly content: { readonly "application/json": { readonly schema: JsonSchema } };
  };
  readonly responses: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/** The data of an extension to `commands`: `{ operation, exposures?, labels? }`. */
export interface GeneratedCommand {
  readonly operation: GeneratedOperation;
  readonly exposures?: ExposuresConfig;
  readonly labels?: CommandConfig["labels"];
}

const EMPTY_INPUT = { type: "object", properties: {}, additionalProperties: false } as const;

function json(schema: JsonSchema) {
  return { content: { "application/json": { schema } } };
}

/** The body schema of one declared error: `{ code, message?, data? }`. */
function errorBody(code: string, data: JsonSchema | undefined): Record<string, unknown> {
  return {
    type: "object",
    required: data === undefined ? ["code"] : ["code", "data"],
    properties: {
      code: { const: code },
      message: { type: "string" },
      ...(data === undefined ? {} : { data }),
    },
  };
}

/**
 * The responses of a command: `200` (its output, or any JSON when none is declared) and one
 * per error status. Errors sharing a status share the response: `code` is then an `enum` (what
 * `system.commands` reads the codes from), and each code's body is one branch of a `oneOf`.
 */
function responses(id: string, command: CommandConfig): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {
    "200": {
      description: "The command's result",
      ...(command.output !== undefined ? json(toJsonSchema(command.output, "output")) : {}),
    },
  };
  const groups = new Map<string, { code: string; description?: string; data?: JsonSchema }[]>();
  for (const [code, error] of Object.entries(command.errors ?? {})) {
    const status = String(error.status ?? 400);
    if (!/^[45]([0-9]{2}|XX)$/.test(status)) {
      throw new Error(`Command "${id}": error "${code}" has status ${status}, not 4xx or 5xx`);
    }
    const group = groups.get(status) ?? [];
    group.push({
      code,
      ...(error.description !== undefined ? { description: error.description } : {}),
      ...(error.data !== undefined ? { data: toJsonSchema(error.data, "output") } : {}),
    });
    groups.set(status, group);
  }
  for (const [status, group] of groups) {
    const first = group[0];
    if (!first) continue;
    const description = group.map((e) => e.description ?? e.code).join("; ");
    const schema =
      group.length === 1
        ? errorBody(first.code, first.data)
        : {
            type: "object",
            required: ["code"],
            properties: { code: { enum: group.map((e) => e.code) }, message: { type: "string" } },
            oneOf: group.map((e) => errorBody(e.code, e.data)),
          };
    out[status] = { description, ...json(schema) };
  }
  return out;
}

/** The OpenAPI operation of command `id`. */
export function commandOperation(id: string, command: CommandConfig): GeneratedOperation {
  const input = command.input === undefined ? EMPTY_INPUT : toJsonSchema(command.input, "input");
  if (typeof input !== "object" || input.type !== "object") {
    throw new Error(`Command "${id}": its input must be an object schema`);
  }
  return {
    operationId: id,
    ...(command.summary !== undefined ? { summary: command.summary } : {}),
    ...(command.description !== undefined ? { description: command.description } : {}),
    requestBody: { required: true, ...json(input) },
    responses: responses(id, command),
  };
}

/** The data of the `commands` extension declaring command `id`. */
export function commandData(id: string, command: CommandConfig): GeneratedCommand {
  return {
    operation: commandOperation(id, command),
    ...(command.exposures ? { exposures: command.exposures } : {}),
    ...(command.labels ? { labels: command.labels } : {}),
  };
}

/** The `commands` extensions of a config, in declaration order. */
export function commandExtensions(config: FragmentConfig) {
  return Object.entries(config.commands ?? {}).map(([id, command]) => ({
    point: COMMANDS_POINT,
    data: commandData(id, command),
    ...(command.handler ? { reference: command.handler } : {}),
  }));
}

/** The catalogue's file at the archive's root, served as the fragment's `.well-known/openapi.json`. */
export const CATALOGUE_FILE = "openapi.json";

/**
 * The fragment's OpenAPI 3.1 command catalogue: every command, one `POST` each, at its `http`
 * path or `/commands/<command-id>` (the path `system.commands` gives an `mcp` exposure without
 * one), its operation exactly the one its `commands` extension declares, its exposures and
 * labels in `x-exposures` and `x-labels`. `undefined` for a fragment without commands.
 */
export function openApiCatalogue(config: FragmentConfig): Record<string, unknown> | undefined {
  const entries = Object.entries(config.commands ?? {});
  if (entries.length === 0) return undefined;
  const paths: Record<string, { post: Record<string, unknown> }> = {};
  for (const [id, command] of entries) {
    const path = command.exposures?.http?.path ?? `/commands/${id}`;
    if (paths[path]) throw new Error(`Commands share the catalogue path ${path}`);
    paths[path] = {
      post: {
        ...commandOperation(id, command),
        ...(command.exposures ? { "x-exposures": command.exposures } : {}),
        ...(command.labels ? { "x-labels": command.labels } : {}),
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: config.name ?? config.id, version: config.version },
    "x-fragment": config.id,
    paths,
  };
}
