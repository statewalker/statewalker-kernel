import { createKernel, type ExtensionReference } from "@statewalker/kernel.core";
import { Slots } from "@statewalker/shared-slots";
import {
  createSystemCommands,
  SYSTEM_COMMANDS_ID,
  systemCommandsArchive,
} from "@statewalker/system.commands";
import {
  createSystemSecurity,
  SYSTEM_SECURITY_ID,
  type SystemSecurityOptions,
  systemSecurityArchive,
} from "../src/index.js";

const SCHEMA = "https://example.org/schemas/fragment.v1.schema.json";
const ASPECT_SCHEMA = "https://example.org/schemas/fragment-aspect.v1.schema.json";

export interface Contribution {
  readonly point: string;
  readonly data: Record<string, unknown>;
  readonly reference?: ExtensionReference;
}

/** A fragment's archive: its manifest and a client aspect with these extensions. */
export function fragment(id: string, extensions: Contribution[] = []): Record<string, string> {
  return {
    "fragment.jsonc": `${JSON.stringify({
      $schema: SCHEMA,
      id,
      version: "1.0.0",
      engines: { platform: "^1.0.0" },
      aspects: { client: {} },
    })}\n`,
    "fragment.client.jsonc": `${JSON.stringify({ $schema: ASPECT_SCHEMA, extensions })}\n`,
  };
}

/**
 * A command `<id>` with an object input (any properties), its handler the module export of the same name; an
 * `agent` exposure with `action` unless it is `undefined`, plus any other exposures.
 */
export function command(
  id: string,
  action: "read" | "write" | "admin" | undefined,
  exposures: Record<string, unknown> = {},
): Contribution {
  return {
    point: "commands",
    data: {
      operation: {
        operationId: id,
        requestBody: { content: { "application/json": { schema: { type: "object" } } } },
      },
      exposures: { ...(action ? { agent: { action } } : {}), ...exposures },
    },
    reference: { module: "./commands.js", export: id },
  };
}

export type Handlers = Record<string, Record<string, (...args: never[]) => unknown>>;

/**
 * The real kernel with system.commands and system.security as core fragments, the bus gated by
 * system.security, the given fragments installed, enabled and their client aspect active.
 */
export async function platform(
  archives: Record<string, string>[],
  handlers: Handlers = {},
  options: Omit<SystemSecurityOptions, "slots"> & { core?: Record<string, string>[] } = {},
) {
  const slots = new Slots();
  const { core = [], ...securityOptions } = options;
  const security = createSystemSecurity({ ...securityOptions, slots });
  const commands = createSystemCommands({ gate: security.gate });
  const errors: unknown[] = [];
  const kernel = createKernel({
    platform: { version: "1.0.0", bindings: [] },
    slots,
    core: [systemCommandsArchive, systemSecurityArchive, ...core],
    onError: (_id, _aspect, error) => errors.push(error),
    resolvers: {
      module: (ref, { contributor }) => handlers[contributor.id]?.[ref.export ?? "default"],
    },
    activators: {
      client: (f, context) =>
        f.id === SYSTEM_COMMANDS_ID
          ? commands.activate(context)
          : f.id === SYSTEM_SECURITY_ID
            ? security.activate(context)
            : undefined,
    },
  });
  await kernel.start();
  const installed = await kernel.install(archives);
  for (const f of installed) await kernel.enable(f.id);
  await kernel.activate("client");
  return { kernel, slots, bus: commands.bus, security, errors };
}

/** Whether a promise is still pending after the queued work has run. */
export async function pending(promise: Promise<unknown>): Promise<boolean> {
  const marker = Symbol("pending");
  promise.catch(() => {});
  const result = await Promise.race([
    promise.then(
      () => "settled",
      () => "settled",
    ),
    new Promise((resolve) => setTimeout(() => resolve(marker), 20)),
  ]);
  return result === marker;
}
