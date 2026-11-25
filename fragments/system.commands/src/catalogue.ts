import type { Extension } from "@statewalker/kernel.core";

export type JsonSchema = Readonly<Record<string, unknown>> | boolean;

/** What a command does, which drives the agent's mode (harness action kinds). */
export type ActionKind = "read" | "write" | "admin";

/** Where a command is offered besides the bus; each one opt-in. */
export interface Exposures {
  readonly agent?: { readonly action: ActionKind };
  readonly http?: { readonly path: string };
  readonly mcp?: Readonly<Record<string, never>>;
  /** Served from the task queue (system.tasks); the operation is idempotent with a JSON output. */
  readonly task?: Readonly<Record<string, never>>;
}

/** A localized title and description. */
export interface Label {
  readonly title?: string;
  readonly description?: string;
}

/** The OpenAPI 3.1 operation a command is declared as (the parts the bus reads). */
export interface CommandOperation {
  readonly operationId: string;
  readonly summary?: string;
  readonly description?: string;
  readonly requestBody?: {
    readonly content: { readonly "application/json": { readonly schema: JsonSchema } };
  };
  readonly responses?: Readonly<
    Record<
      string,
      {
        readonly description?: string;
        readonly content?: { readonly "application/json"?: { readonly schema?: JsonSchema } };
      }
    >
  >;
  readonly [key: string]: unknown;
}

/** The data of an extension to `commands`. */
export interface CommandData {
  readonly operation: CommandOperation;
  readonly exposures?: Exposures;
  readonly labels?: Readonly<Record<string, Label>>;
}

/** An error an operation declares: a non-2xx response whose schema names its code(s). */
export interface DeclaredError {
  /** The response key: `404`, `4XX`, `default`. */
  readonly status: string;
  readonly codes: readonly string[];
  /** The body's schema (`{ code, message?, data? }`). */
  readonly schema: JsonSchema;
}

/** One live command of the catalogue. */
export interface CommandEntry {
  /** Its identity: `<fragment-id>/<command-id>`. */
  readonly id: string;
  /** The contributing fragment. */
  readonly fragment: string;
  /** The command id, the operation's `operationId`. */
  readonly command: string;
  readonly operation: CommandOperation;
  /** The exposures in effect: `mcp` implies `http` (`defaultHttpPath` unless a path is given). */
  readonly exposures: Exposures;
  readonly labels: Readonly<Record<string, Label>>;
  /** The input schema: the JSON request body's, or a closed empty object. */
  readonly input: JsonSchema;
  /** The output schema: the 200 JSON response's, if declared. */
  readonly output?: JsonSchema;
  /** The errors the operation declares: its non-2xx responses naming a code. */
  readonly errors: readonly DeclaredError[];
  /** Whether a handler is declared (the extension's lazy reference). */
  readonly handled: boolean;
  /** The extension it comes from. */
  readonly extension: Extension;
}

const EMPTY_INPUT = { type: "object", properties: {}, additionalProperties: false } as const;

/** The catalogue entry of a `commands` extension (its data already valid against the point). */
export function entryOf(extension: Extension): CommandEntry {
  const data = extension.data as CommandData;
  const operation = data.operation;
  return Object.freeze({
    id: `${extension.contributor}/${operation.operationId}`,
    fragment: extension.contributor,
    command: operation.operationId,
    operation,
    exposures: exposuresOf(data.exposures ?? {}, operation.operationId),
    labels: data.labels ?? {},
    input: operation.requestBody?.content["application/json"].schema ?? EMPTY_INPUT,
    output: operation.responses?.["200"]?.content?.["application/json"]?.schema,
    errors: declaredErrors(operation),
    handled: extension.reference !== undefined,
    extension,
  });
}

/** The codes a schema names in `properties.code`: its `const`, or its `enum`'s strings. */
function codesOf(schema: JsonSchema | undefined): string[] {
  if (!schema || typeof schema !== "object") return [];
  const code = (
    schema.properties as Record<string, { const?: unknown; enum?: unknown }> | undefined
  )?.code;
  if (typeof code?.const === "string") return [code.const];
  return Array.isArray(code?.enum) ? code.enum.filter((c) => typeof c === "string") : [];
}

function declaredErrors(operation: CommandOperation): DeclaredError[] {
  const out: DeclaredError[] = [];
  for (const [status, response] of Object.entries(operation.responses ?? {})) {
    if (/^2/.test(status)) continue;
    const schema = response?.content?.["application/json"]?.schema;
    const codes = codesOf(schema);
    if (schema !== undefined && codes.length > 0) out.push({ status, codes, schema });
  }
  return out;
}

/** The HTTP path an `mcp`-exposed command takes when it declares no `http` exposure. */
export function defaultHttpPath(command: string): string {
  return `/commands/${command}`;
}

/** The exposures in effect: `mcp` implies `http`, at the default path unless one is given. */
function exposuresOf(exposures: Exposures, command: string): Exposures {
  if (!exposures.mcp || exposures.http) return exposures;
  return { ...exposures, http: { path: defaultHttpPath(command) } };
}
