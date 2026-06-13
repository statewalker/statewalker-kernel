// Source: @statewalker/shared-logger (logger.adapter.ts)
// Copied: 2026-04-19
// Narrow slice: the Logger type + a minimal context-keyed lookup. The
// backbone does not need the adapter-registration machinery from
// @statewalker/shared-adapters, so getLogger/setLogger here are plain
// context-keyed accessors with a lazy console fallback.
// See ./README.md for policy.

const Levels = {
  fatal: 5,
  error: 4,
  warn: 3,
  info: 2,
  debug: 1,
  trace: 0,
} as const;

export type LoggerLevel = keyof typeof Levels;

export type Logger = {
  level: LoggerLevel;
  fatal: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  trace: (...args: unknown[]) => void;
  child: (metadata: Record<string, unknown>) => Logger;
};

function getProcessId(context: Record<string, unknown>): string {
  const key = "app.processId";
  context[key] = context[key] || Math.random().toString(16).slice(8);
  return context[key] as string;
}

function newConsoleLogger(
  logLevel: LoggerLevel = "info",
  metadata: Record<string, unknown> = {},
): Logger {
  let rowCounter = 0;
  return newLogger(metadata);

  function newLogger(meta: Record<string, unknown> = {}): Logger {
    const newWriter = (
      method: "trace" | "debug" | "info" | "warn" | "error",
      level: LoggerLevel = method,
    ) => {
      const prefix = `[${level.toUpperCase()}]`.padStart(7, " ");
      return (...args: unknown[]) => {
        if (Levels[logLevel] > Levels[level]) return;
        console[method](`[${String(rowCounter++).padStart(7, "0")}]${prefix}`, ...args, meta);
      };
    };
    const logger: Logger = {
      get level() {
        return logLevel;
      },
      set level(newLevel: LoggerLevel) {
        if (Levels[newLevel] === undefined) {
          throw new Error(`Unknown log level: ${newLevel}`);
        }
        logLevel = newLevel;
      },
      info: newWriter("info"),
      debug: newWriter("debug"),
      trace: newWriter("trace"),
      warn: newWriter("warn"),
      error: newWriter("error"),
      fatal: newWriter("error", "fatal"),
      child: (newMetadata) => newLogger({ ...meta, ...newMetadata }),
    };
    return logger;
  }
}

const LOGGER_KEY = "app.logger";

export function getLogger(context: Record<string, unknown>): Logger {
  const existing = context[LOGGER_KEY] as Logger | undefined;
  if (existing) return existing;

  const fallback = newConsoleLogger("warn").child({
    processId: getProcessId(context),
  });
  const logLevel = (process.env.LOG_LEVEL ?? "info") as LoggerLevel;
  fallback.level = logLevel;
  fallback.info(`[backbone] Starting up with log level: ${logLevel}`);
  context[LOGGER_KEY] = fallback;
  return fallback;
}

export function setLogger(context: Record<string, unknown>, logger: Logger): void {
  context[LOGGER_KEY] = logger;
}
