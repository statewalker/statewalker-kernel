import { type Logger, type LoggerLevel, newConsoleLogger } from "@statewalker/shared-logger";
import type { AdapterCtor } from "./adapters-registry.js";

export type { Logger, LoggerLevel };

/** A no-op `Logger`, returned when no `LoggerAdapter` backend is registered. */
export const NULL_LOGGER: Logger = {
  level: "info",
  fatal: () => {},
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
  child: () => NULL_LOGGER,
};

/** Level-specific metadata derived from a handle (workspace `label` / project `projectName`). */
export function loggerMetaOf(host: unknown): Record<string, unknown> {
  const h = host as { label?: string; projectName?: string; workspace?: { label?: string } };
  if (h && typeof h.projectName === "string") {
    const meta: Record<string, unknown> = { project: h.projectName };
    const wsLabel = h.workspace?.label;
    if (wsLabel) meta.workspace = wsLabel;
    return meta;
  }
  if (h && typeof h.label === "string") return { workspace: h.label };
  return {};
}

/**
 * Token for obtaining named loggers, resolvable at the workspace and project
 * levels. The base returns `NULL_LOGGER`; an environment registers a concrete
 * backend — a console one in the browser, a pino one in Node — so the core stays
 * free of `@statewalker/shared-logger-pino`.
 */
export class LoggerAdapter {
  constructor(
    protected readonly host: unknown,
    protected readonly options: Record<string, unknown> = {},
  ) {}

  newLogger(_key: string, _meta?: Record<string, unknown>): Logger {
    return NULL_LOGGER;
  }
}

/** A console-backed `LoggerAdapter` (browser-safe), stamping the handle's metadata. */
export class ConsoleLoggerAdapter extends LoggerAdapter {
  readonly meta: Record<string, unknown>;
  private readonly root: Logger;

  constructor(host: unknown, level: LoggerLevel = "info") {
    super(host);
    this.meta = loggerMetaOf(host);
    this.root = newConsoleLogger(level, this.meta);
  }

  override newLogger(key: string, meta?: Record<string, unknown>): Logger {
    return this.root.child({ name: key, ...(meta ?? {}) });
  }
}

/** The named logger from a registered `LoggerAdapter`, or `NULL_LOGGER`. */
export function loggerOf(
  host: { getAdapter<T>(type: AdapterCtor<T>): T | null } | unknown,
  key: string,
  meta?: Record<string, unknown>,
): Logger {
  const h = host as { getAdapter?<T>(type: AdapterCtor<T>): T | null };
  const adapter = typeof h?.getAdapter === "function" ? h.getAdapter(LoggerAdapter) : null;
  return adapter?.newLogger(key, meta) ?? NULL_LOGGER;
}
