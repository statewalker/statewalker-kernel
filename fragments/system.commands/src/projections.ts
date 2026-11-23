// Projections of the catalogue, derived on demand and never stored (ADR
// 2026-11-21-commands-exposures-and-agents, decisions 3 and 4):
//
// - harness tool documents, for `agent`-exposed commands only, in the restricted profile of
//   statewalker-root#90 as statewalker-ai's `ai-definitions` builds it (`toolDefinition`): one
//   OpenAPI 3.1 document per tool, one `POST /tools/<id>`, a closed object input, the 200 JSON
//   output, and the `x-dev.cellb.harness` extension. That package is not on npm yet, so the
//   format is reproduced here and pinned by a test;
// - MCP `tools/list` entries, for `mcp`-exposed commands only.
//
// A tool's identity is `<fragment-id>/<command-id>`, its permission
// `tools.use:<fragment-id>/<command-id>`, its name provider-safe and unique.
import type { ActionKind, CommandEntry, JsonSchema, Label } from "./catalogue.js";

/** The extension carrying what the harness knows of a tool. */
export const TOOL_EXTENSION = "x-dev.cellb.harness";

/** How the harness reaches a fragment command: through the host, by the command's identity. */
export interface HarnessRoute {
  readonly kind: "harness";
  /** The command's identity, `<fragment-id>/<command-id>`. */
  readonly entry: string;
}

/** The `x-dev.cellb.harness` extension of a tool document. */
export interface HarnessToolExtension {
  /** `<fragment-id>/<command-id>`. */
  readonly id: string;
  /** The provider-safe name: `[A-Za-z0-9_-]`, at most 64 characters. */
  readonly name: string;
  readonly source: "harness";
  /** The fragment id, in the harness's `plugin` slot. */
  readonly plugin: string;
  /** The command id. */
  readonly tool: string;
  readonly action: ActionKind;
  /** `tools.use:<fragment-id>/<command-id>`. */
  readonly permission: string;
  readonly route: HarnessRoute;
}

/** One tool as one OpenAPI 3.1 document in the harness's restricted profile. */
export interface HarnessToolDocument {
  readonly openapi: "3.1.0";
  readonly info: { readonly title: string; readonly version: string; readonly description: string };
  readonly paths: Record<
    string,
    {
      readonly post: {
        readonly operationId: string;
        readonly summary: string;
        readonly requestBody: {
          readonly required: true;
          readonly content: { readonly "application/json": { readonly schema: JsonSchema } };
        };
        readonly responses: {
          readonly 200: {
            readonly description: string;
            readonly content: { readonly "application/json": { readonly schema: JsonSchema } };
          };
          readonly default: { readonly description: string };
        };
      };
    }
  >;
  readonly [TOOL_EXTENSION]: HarnessToolExtension;
}

/** An entry of MCP `tools/list`. */
export interface McpTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly outputSchema?: JsonSchema;
  readonly annotations?: {
    readonly readOnlyHint: boolean;
    readonly destructiveHint: boolean;
    readonly openWorldHint: boolean;
  };
}

export interface ProjectionOptions {
  /** The locale labels are taken in (`fr-CA` falls back to `fr`, then to the operation). */
  readonly locale?: string;
}

/** The permission a role grants to use a command as a tool. */
export function toolPermission(id: string): string {
  return `tools.use:${id}`;
}

// --- names ----------------------------------------------------------------------------------------

const MAX_NAME = 64;

/** FNV-1a, 32 bits, as 8 hex digits (as the harness's `toolName`). */
function hash32(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** The harness's name rule: `<plugin>__<tool>` made safe, a hash suffix when too long or asked. */
function safeName(fragment: string, command: string, hashed: boolean): string {
  const raw = `${fragment}__${command}`;
  const safe = raw.replace(/[^A-Za-z0-9_-]/g, "_");
  if (!hashed && safe.length <= MAX_NAME) return safe;
  return `${safe.slice(0, MAX_NAME - 9)}_${hash32(raw)}`;
}

const isExposed = (c: CommandEntry) =>
  c.exposures.agent !== undefined || c.exposures.mcp !== undefined;

/**
 * The provider-safe name of every exposed command, by identity. Names that two commands share
 * once made safe take the hashed form for each of them, so a name never depends on the order
 * commands arrived in.
 */
export function toolNames(commands: readonly CommandEntry[]): ReadonlyMap<string, string> {
  const exposed = commands.filter(isExposed);
  const counts = new Map<string, number>();
  for (const c of exposed) {
    const name = safeName(c.fragment, c.command, false);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const names = new Map<string, string>();
  for (const c of exposed) {
    const plain = safeName(c.fragment, c.command, false);
    names.set(c.id, (counts.get(plain) ?? 0) > 1 ? safeName(c.fragment, c.command, true) : plain);
  }
  return names;
}

/** The exposed command a tool name stands for: the reverse of `toolNames`. */
export function toolByName(
  commands: readonly CommandEntry[],
  name: string,
): CommandEntry | undefined {
  for (const [id, n] of toolNames(commands))
    if (n === name) return commands.find((c) => c.id === id);
  return undefined;
}

// --- labels and schemas ---------------------------------------------------------------------------

function labelOf(entry: CommandEntry, locale: string | undefined): Label {
  if (!locale) return {};
  const wanted = locale.toLowerCase();
  const language = wanted.split("-")[0];
  const keys = Object.keys(entry.labels);
  const key =
    keys.find((k) => k.toLowerCase() === wanted) ?? keys.find((k) => k.toLowerCase() === language);
  return key ? (entry.labels[key] ?? {}) : {};
}

/** A command's title and description in `locale`, falling back to its operation. */
export function labelsOf(entry: CommandEntry, locale?: string): Required<Label> {
  const label = labelOf(entry, locale);
  const { summary, description } = entry.operation;
  const title = label.title ?? summary ?? entry.id;
  return { title, description: label.description ?? description ?? summary ?? title };
}

/** Every object schema closed (`additionalProperties: false` where it says nothing), recursively. */
export function closedSchema(schema: unknown): Record<string, unknown> {
  const walk = (s: unknown): unknown => {
    if (Array.isArray(s)) return s.map(walk);
    if (!s || typeof s !== "object") return s;
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) o[k] = walk(v);
    if (o.type === "object" && o.additionalProperties === undefined) o.additionalProperties = false;
    return o;
  };
  const out = walk(schema ?? {}) as Record<string, unknown>;
  return out.type === "object"
    ? out
    : { type: "object", properties: {}, additionalProperties: false };
}

const declaredOutput = (entry: CommandEntry): JsonSchema | undefined =>
  entry.output && typeof entry.output === "object" && Object.keys(entry.output).length > 0
    ? entry.output
    : undefined;

// --- projections ----------------------------------------------------------------------------------

/** The harness tool documents of the `agent`-exposed commands, in catalogue order. */
export function harnessTools(
  commands: readonly CommandEntry[],
  options: ProjectionOptions = {},
): HarnessToolDocument[] {
  const names = toolNames(commands);
  const out: HarnessToolDocument[] = [];
  for (const entry of commands) {
    const agent = entry.exposures.agent;
    const name = names.get(entry.id);
    if (!agent || !name) continue;
    const { description } = labelsOf(entry, options.locale);
    out.push({
      openapi: "3.1.0",
      info: { title: entry.id, version: "1", description },
      paths: {
        [`/tools/${entry.id}`]: {
          post: {
            operationId: name,
            summary: description,
            requestBody: {
              required: true,
              content: { "application/json": { schema: closedSchema(entry.input) } },
            },
            responses: {
              200: {
                description: "The tool's result",
                content: { "application/json": { schema: entry.output ?? {} } },
              },
              default: { description: "The tool failed, or the call was refused" },
            },
          },
        },
      },
      [TOOL_EXTENSION]: {
        id: entry.id,
        name,
        source: "harness",
        plugin: entry.fragment,
        tool: entry.command,
        action: agent.action,
        permission: toolPermission(entry.id),
        route: { kind: "harness", entry: entry.id },
      },
    });
  }
  return out;
}

/**
 * The MCP `tools/list` entries of the `mcp`-exposed commands, in catalogue order: all of them
 * (`/.well-known/mcp`), or one fragment's (`/fragments/{id}/.well-known/mcp`).
 */
export function mcpTools(
  commands: readonly CommandEntry[],
  options: ProjectionOptions & { readonly fragment?: string } = {},
): McpTool[] {
  const names = toolNames(commands);
  const out: McpTool[] = [];
  for (const entry of commands) {
    const name = names.get(entry.id);
    if (!entry.exposures.mcp || !name) continue;
    if (options.fragment !== undefined && entry.fragment !== options.fragment) continue;
    const { title, description } = labelsOf(entry, options.locale);
    const output = declaredOutput(entry);
    const action = entry.exposures.agent?.action;
    out.push({
      name,
      title,
      description,
      inputSchema: closedSchema(entry.input),
      ...(output ? { outputSchema: output } : {}),
      ...(action
        ? {
            annotations: {
              readOnlyHint: action === "read",
              destructiveHint: action === "admin",
              openWorldHint: false,
            },
          }
        : {}),
    });
  }
  return out;
}
