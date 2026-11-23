import { createKernel, type FragmentFiles } from "@statewalker/kernel.core";
import {
  createSystemCommands,
  SYSTEM_COMMANDS_ID,
  systemCommandsArchive,
} from "@statewalker/system.commands";

export type Handlers = Record<string, Record<string, (...args: never[]) => unknown>>;

/**
 * The real kernel with system.commands as its core fragment; `archives` installed, enabled
 * and their client aspect active. Handlers are module exports, by contributor then export.
 */
export async function platform(archives: FragmentFiles[], handlers: Handlers = {}) {
  const system = createSystemCommands();
  const errors: unknown[] = [];
  const kernel = createKernel({
    platform: { version: "1.0.0", bindings: ["durable-objects"] },
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
  return { kernel, bus: system.bus, errors, installed };
}
