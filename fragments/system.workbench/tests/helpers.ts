// Seam 1 helpers: the real kernel with system.commands and system.workbench as core fragments,
// and test fragments contributing to their points.
import { createKernel, type ExtensionReference } from "@statewalker/kernel.core";
import {
  createSystemCommands,
  SYSTEM_COMMANDS_ID,
  systemCommandsArchive,
} from "@statewalker/system.commands";
import {
  createSystemWorkbench,
  SYSTEM_WORKBENCH_ID,
  type SystemWorkbenchOptions,
  systemWorkbenchArchive,
} from "../src/index.js";

const SCHEMA = "https://example.org/schemas/fragment.v1.schema.json";
const ASPECT_SCHEMA = "https://example.org/schemas/fragment-aspect.v1.schema.json";

export interface TestExtension {
  readonly point: string;
  readonly data: unknown;
  readonly reference?: ExtensionReference;
}

/** A client-only fragment with these extensions. */
export function fragment(id: string, extensions: TestExtension[]): Record<string, string> {
  return {
    "fragment.jsonc": JSON.stringify({
      $schema: SCHEMA,
      id,
      version: "1.0.0",
      engines: { platform: "^1.0.0" },
      aspects: { client: {} },
    }),
    "fragment.client.jsonc": JSON.stringify({ $schema: ASPECT_SCHEMA, extensions }),
  };
}

/** A command with no input, its handler the module export of the same name. */
export function command(id: string, extra: Record<string, unknown> = {}): TestExtension {
  return {
    point: "commands",
    data: { operation: { operationId: id, summary: `Summary of ${id}` }, ...extra },
    reference: { module: "./index.js", export: id },
  };
}

export const ext = (point: string, data: unknown): TestExtension => ({ point, data });

/**
 * The kernel with both core fragments, these fragments installed, enabled and active. Module
 * references resolve to `handlers[export]`; `loaded` records each resolution (the contributor's
 * code loading).
 */
export async function platform(
  archives: Record<string, string>[],
  handlers: Record<string, (input: unknown) => unknown> = {},
  options: Omit<SystemWorkbenchOptions, "commands"> = {},
) {
  const commands = createSystemCommands();
  const system = createSystemWorkbench({ ...options, commands: commands.bus });
  const loaded: string[] = [];
  const kernel = createKernel({
    platform: { version: "1.0.0", bindings: [] },
    core: [systemCommandsArchive, systemWorkbenchArchive],
    resolvers: {
      module: (ref, { contributor }) => {
        loaded.push(`${contributor.id}#${ref.export}`);
        return handlers[ref.export ?? "default"] ?? `${contributor.id}#${ref.export}`;
      },
    },
    activators: {
      client: (f, context) => {
        if (f.id === SYSTEM_COMMANDS_ID) return commands.activate(context);
        if (f.id === SYSTEM_WORKBENCH_ID) return system.activate(context);
        return undefined;
      },
    },
  });
  await kernel.start();
  for (const f of await kernel.install(archives)) await kernel.enable(f.id);
  await kernel.activate("client");
  return { kernel, bus: commands.bus, workbench: system.workbench, loaded };
}
