import { DatabaseSync } from "node:sqlite";
import { createKernel, type ExtensionReference } from "@statewalker/kernel.core";
import type { SqlLike } from "@statewalker/shared-tasks";
import {
  type CallGate,
  createSystemCommands,
  SYSTEM_COMMANDS_ID,
  systemCommandsArchive,
} from "@statewalker/system.commands";
import { createSystemTasks, SYSTEM_TASKS_ID, systemTasksArchive } from "../src/index.js";

const SCHEMA = "https://example.org/schemas/fragment.v1.schema.json";
const ASPECT_SCHEMA = "https://example.org/schemas/fragment-aspect.v1.schema.json";

/** An SQLite database in memory, as the queue's `SqlLike`, with the raw handle for checks. */
export function sqlite(): { sql: SqlLike; db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  const sql: SqlLike = {
    exec: (query, ...bindings) => {
      const rows = db.prepare(query).all(...(bindings as never[]));
      return { toArray: () => rows as Record<string, unknown>[] };
    },
  };
  return { sql, db };
}

export interface CommandExtension {
  readonly data: Record<string, unknown>;
  readonly reference?: ExtensionReference;
}

/** A fragment's archive: its manifest and a client aspect file with these command extensions. */
export function fragment(id: string, commands: CommandExtension[]): Record<string, string> {
  return {
    "fragment.jsonc": `${JSON.stringify({
      $schema: SCHEMA,
      id,
      version: "1.0.0",
      engines: { platform: "^1.0.0" },
      aspects: { client: {} },
    })}\n`,
    "fragment.client.jsonc": `${JSON.stringify({
      $schema: ASPECT_SCHEMA,
      extensions: commands.map((e) => ({ point: "commands", ...e })),
    })}\n`,
  };
}

/** A command served from the queue: idempotent, with a JSON object output; its handler `id`. */
export function taskCommand(id: string, extra: Record<string, unknown> = {}): CommandExtension {
  return {
    data: {
      operation: {
        operationId: id,
        "x-idempotent": true,
        requestBody: { content: { "application/json": { schema: { type: "object" } } } },
        responses: {
          200: {
            description: "ok",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
      exposures: { task: {} },
      ...extra,
    },
    reference: { module: "./commands.js", export: id },
  };
}

export type Handlers = Record<string, Record<string, (...args: never[]) => unknown>>;

/**
 * The real kernel with system.commands and system.tasks as its core fragments over an
 * in-memory queue, the given fragments installed, enabled and their client aspect active.
 */
export async function platform(
  archives: Record<string, string>[],
  handlers: Handlers = {},
  options: { gate?: CallGate; leaseMs?: number; maxAttempts?: number } = {},
) {
  const { sql, db } = sqlite();
  const commands = createSystemCommands(options.gate ? { gate: options.gate } : {});
  let tasks!: ReturnType<typeof createSystemTasks>;
  const kernel = createKernel({
    platform: { version: "1.0.0", bindings: [] },
    core: [systemCommandsArchive, systemTasksArchive],
    resolvers: {
      module: (ref, { contributor }) =>
        contributor.id === SYSTEM_TASKS_ID
          ? tasks.module[ref.export ?? "default"]
          : handlers[contributor.id]?.[ref.export ?? "default"],
    },
    activators: {
      client: (f, context) => {
        if (f.id === SYSTEM_COMMANDS_ID) return commands.activate(context);
        if (f.id === SYSTEM_TASKS_ID) return tasks.activate(context);
        return undefined;
      },
    },
  });
  tasks = createSystemTasks({
    commands: commands.bus,
    slots: kernel.slots,
    sql,
    waitMs: 50,
    ...(options.gate ? { gate: options.gate } : {}),
    ...(options.leaseMs ? { leaseMs: options.leaseMs } : {}),
    ...(options.maxAttempts ? { maxAttempts: options.maxAttempts } : {}),
  });
  await kernel.start();
  const installed = await kernel.install(archives);
  for (const f of installed) await kernel.enable(f.id);
  await kernel.activate("client");
  return { kernel, bus: commands.bus, tasks, db };
}

/** Waits until `check` holds, polling every 5 ms, up to 2 s. */
export async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("timed out");
}
