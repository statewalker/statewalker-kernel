/**
 * Why a call failed:
 *
 * - `unknown-command`: no live command has this identity (never declared, or its fragment left);
 * - `forbidden`: the caller is not the user and the gate refused the call, or no gate is wired;
 *   the handler did not run;
 * - `invalid-input`: the input does not match the input schema; the handler did not run;
 * - `no-handler`: the command is declared without a handler;
 * - `unavailable`: the contributing fragment left while the call ran (`ExtensionUnavailable`);
 * - `declared-error`: the handler raised one of the errors the operation declares;
 * - `handler-error`: the handler threw anything else;
 * - `invalid-output`: the result does not match the output schema.
 */
export type CommandCallErrorKind =
  | "unknown-command"
  | "forbidden"
  | "invalid-input"
  | "no-handler"
  | "unavailable"
  | "declared-error"
  | "handler-error"
  | "invalid-output";

export interface CommandCallErrorOptions {
  readonly message?: string;
  readonly cause?: unknown;
  /** The schema violations, one line each (`invalid-input`, `invalid-output`). */
  readonly issues?: readonly string[];
  readonly code?: string;
  readonly status?: string;
  readonly data?: unknown;
}

/** The one error a bus call rejects with; tell the cases apart by `kind`. */
export class CommandCallError extends Error {
  readonly kind: CommandCallErrorKind;
  /** The command's identity, `<fragment-id>/<command-id>`. */
  readonly command: string;
  readonly issues: readonly string[];
  /** A declared error's code. */
  readonly code?: string;
  /** A declared error's response key in the operation (`404`, `4XX`, `default`). */
  readonly status?: string;
  /** A declared error's data. */
  readonly data?: unknown;

  constructor(kind: CommandCallErrorKind, command: string, options: CommandCallErrorOptions = {}) {
    super(
      options.message ?? `${kind}: ${command}`,
      options.cause !== undefined ? { cause: options.cause } : undefined,
    );
    this.name = "CommandCallError";
    this.kind = kind;
    this.command = command;
    this.issues = options.issues ?? [];
    if (options.code !== undefined) this.code = options.code;
    if (options.status !== undefined) this.status = options.status;
    if (options.data !== undefined) this.data = options.data;
  }
}

/**
 * What a handler throws to raise one of its operation's declared errors: an error response
 * whose JSON schema names the code (`properties.code` as `const` or `enum`). The body
 * `{ code, message, data }` is checked against that schema; an undeclared code or a body that
 * does not match is a `handler-error`.
 */
export class CommandFailure extends Error {
  readonly code: string;
  readonly data?: unknown;

  constructor(code: string, message?: string, data?: unknown) {
    super(message ?? code);
    this.name = "CommandFailure";
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

/** A `CommandFailure`, or its shape after crossing a realm or an RPC boundary. */
export function isCommandFailure(value: unknown): value is CommandFailure {
  if (value instanceof CommandFailure) return true;
  const v = value as { name?: unknown; code?: unknown } | null;
  return (
    typeof v === "object" && v !== null && v.name === "CommandFailure" && typeof v.code === "string"
  );
}
