import type { LoggerLevel } from "@statewalker/shared-logger";
import { newPinoLogger } from "@statewalker/shared-logger-pino";
import { type Logger, LoggerAdapter, loggerMetaOf, type Workspace } from "@statewalker/workspace";

export interface PinoLoggerOptions {
  /** Minimum level; defaults to `info`. */
  level?: LoggerLevel;
}

/**
 * A pino-backed `LoggerAdapter`. In the browser `@statewalker/shared-logger-pino`
 * resolves to pino's browser build, so logs route to `console` (structured) with
 * no `pino-pretty`/fd dependency. `newLogger(key)` returns a child carrying the
 * host's metadata (workspace `label` / project `projectName`) plus `name`.
 */
export class PinoLoggerAdapter extends LoggerAdapter {
  private readonly root: Logger;

  constructor(host: unknown, options: PinoLoggerOptions = {}) {
    super(host, options as Record<string, unknown>);
    this.root = newPinoLogger(options.level ?? "info", loggerMetaOf(host));
  }

  override newLogger(key: string, meta?: Record<string, unknown>): Logger {
    return this.root.child({ name: key, ...(meta ?? {}) });
  }
}

/**
 * Register the pino `LoggerAdapter` for a workspace at every level
 * (workspace / project / resource). Returns a disposer that unregisters them.
 */
export function registerPinoLogger(
  workspace: Workspace,
  options: PinoLoggerOptions = {},
): () => void {
  const make = (host: unknown) => new PinoLoggerAdapter(host, options);
  const unregister = (["workspace", "project", "resource"] as const).map((level) =>
    workspace.adaptersRegistry.register(level, LoggerAdapter, make),
  );
  return () => {
    for (const u of unregister) u();
  };
}
