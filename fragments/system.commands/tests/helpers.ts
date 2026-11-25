import { createKernel, type ExtensionReference } from "@statewalker/kernel.core";
import {
  type CallGate,
  createSystemCommands,
  SYSTEM_COMMANDS_ID,
  systemCommandsArchive,
} from "../src/index.js";

const SCHEMA = "https://example.org/schemas/fragment.v1.schema.json";
const ASPECT_SCHEMA = "https://example.org/schemas/fragment-aspect.v1.schema.json";

export interface CommandExtension {
  readonly data: Record<string, unknown>;
  readonly reference?: ExtensionReference;
}

/** A fragment's archive: its manifest and a client aspect file with these extensions. */
export function fragment(
  id: string,
  extensions: { commands?: CommandExtension[]; keybindings?: Record<string, unknown>[] } = {},
): Record<string, string> {
  const all = [
    ...(extensions.commands ?? []).map((e) => ({ point: "commands", ...e })),
    ...(extensions.keybindings ?? []).map((data) => ({ point: "keybindings", data })),
  ];
  return {
    "fragment.jsonc": `// a test fragment\n${JSON.stringify({
      $schema: SCHEMA,
      id,
      version: "1.0.0",
      engines: { platform: "^1.0.0" },
      aspects: { client: {} },
    })}\n`,
    "fragment.client.jsonc": `${JSON.stringify({ $schema: ASPECT_SCHEMA, extensions: all })}\n`,
  };
}

/** A command extension: an OpenAPI operation, its handler the module export `handler`. */
export function command(
  operation: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  handler = String(operation.operationId),
): CommandExtension {
  return { data: { operation, ...extra }, reference: { module: "./commands.js", export: handler } };
}

/** An operation with an object input and an object output. */
export function operation(
  id: string,
  input: Record<string, unknown> = { type: "object" },
  output?: Record<string, unknown>,
  rest: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    operationId: id,
    requestBody: { content: { "application/json": { schema: input } } },
    responses: {
      200: {
        description: "ok",
        ...(output ? { content: { "application/json": { schema: output } } } : {}),
      },
      ...((rest.responses as object | undefined) ?? {}),
    },
    ...Object.fromEntries(Object.entries(rest).filter(([k]) => k !== "responses")),
  };
}

export type Handlers = Record<string, Record<string, (...args: never[]) => unknown>>;

/**
 * The real kernel with system.commands as its one core fragment, the given fragments
 * installed, enabled and their client aspect active. Handlers are module exports, by
 * contributor id then export name.
 */
export async function platform(
  archives: Record<string, string>[],
  handlers: Handlers = {},
  options: { gate?: CallGate } = {},
) {
  const system = createSystemCommands(options);
  const errors: unknown[] = [];
  const kernel = createKernel({
    platform: { version: "1.0.0", bindings: [] },
    core: [systemCommandsArchive],
    onError: (_id, _aspect, error) => errors.push(error),
    resolvers: {
      module: (ref, { contributor }) => handlers[contributor.id]?.[ref.export ?? "default"],
    },
    activators: {
      client: (f, context) => (f.id === SYSTEM_COMMANDS_ID ? system.activate(context) : undefined),
    },
  });
  await kernel.start();
  const installed = await kernel.install(archives);
  for (const f of installed) await kernel.enable(f.id);
  await kernel.activate("client");
  return { kernel, bus: system.bus, callAs: system.callAs, errors };
}
