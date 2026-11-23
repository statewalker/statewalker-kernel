import {
  type ActivationContext,
  type Extension,
  ExtensionUnavailable,
} from "@statewalker/kernel.core";
import {
  Command,
  type CommandDeclaration,
  CommandError,
  Commands,
} from "@statewalker/shared-commands";
import { COMMANDS_POINT, KEYBINDINGS_POINT } from "./archive.js";
import { type CommandEntry, entryOf } from "./catalogue.js";
import { CommandCallError, isCommandFailure } from "./errors.js";
import { jsonStandardSchema, jsonValidator } from "./json-schema.js";

/** What a handler gets beside its input. Room for ids, progress and cancellation later. */
export interface CommandContext {
  /** The command's identity, `<fragment-id>/<command-id>`. */
  readonly command: string;
}

/**
 * Who makes a call. The user is the default and is never restricted; any other caller (an agent
 * session, a peer, a sandbox) presents the capability system code issued it, and its calls go
 * through the gate.
 */
export type Caller = { readonly kind: "user" } | { readonly capability: string };

/** How a call is made. */
export interface CallOptions {
  /** The caller; the user when absent. */
  readonly caller?: Caller;
}

/** A call the gate decides: from a caller other than the user, before its input is checked. */
export interface CallRequest {
  readonly command: CommandEntry;
  readonly caller: Exclude<Caller, { kind: "user" }>;
  readonly input: unknown;
}

/**
 * Decides a call from a caller other than the user: returns (or resolves) to let it run, throws
 * (or rejects) to refuse it; the call then fails `forbidden` with the thrown error as `cause` and
 * its message. It may wait, as long as an approval takes.
 */
export type CallGate = (request: CallRequest) => void | Promise<void>;

export interface SystemCommandsOptions {
  /**
   * The gate of calls from callers other than the user (system.security's). Without one, every
   * such call is refused.
   */
  readonly gate?: CallGate;
}

/** The internal bus: every live command, callable by its identity. */
export interface CommandBus {
  /**
   * Call the command `id` (`<fragment-id>/<command-id>`) with `input`, validated against its
   * input schema; the result is validated against its output schema. A caller other than the
   * user (`options.caller`) is first let through or refused by the gate.
   */
  call<T = unknown>(id: string, input?: unknown, options?: CallOptions): Promise<T>;
  /** The live commands, in the order their extensions are read. */
  list(): readonly CommandEntry[];
  /** The live command `id`. */
  get(id: string): CommandEntry | undefined;
  /** The live keybindings, in the order their extensions are read. */
  keybindings(): readonly Keybinding[];
  /**
   * Follow the catalogue: `listener` is called at once with the live commands, then after every
   * change to the commands or the keybindings. Projections are recomputed from it, never stored. Returns a disposer.
   */
  observe(listener: (commands: readonly CommandEntry[]) => void): () => void;
}

/** A key chord that calls a command, as declared on the `keybindings` point. */
export interface Keybinding {
  readonly key: string;
  /** The command's identity, `<fragment-id>/<command-id>`. */
  readonly command: string;
  readonly when?: string;
  /** The contributing fragment. */
  readonly fragment: string;
}

/** The system.commands fragment's code: its bus, and the activator body of its client aspect. */
export interface SystemCommands {
  readonly bus: CommandBus;
  /** Activate the client aspect: follow the `commands` and `keybindings` points. Returns the cleanup. */
  activate(context: ActivationContext): () => void;
}

interface Live {
  readonly entry: CommandEntry;
  readonly declaration: CommandDeclaration<unknown, unknown>;
  readonly unlisten?: () => void;
}

/** Only an absent caller or exactly `{ kind: "user" }` is the user; anything else is gated. */
const isUser = (caller: Caller | undefined): caller is { kind: "user" } | undefined =>
  caller === undefined ||
  (typeof caller === "object" &&
    caller !== null &&
    (caller as { kind?: unknown }).kind === "user" &&
    !("capability" in caller));

export function createSystemCommands(options: SystemCommandsOptions = {}): SystemCommands {
  const gate = options.gate;
  const substrate = Commands.create();
  const live = new Map<string, Live>();
  let keybindings: readonly Keybinding[] = [];
  const listeners = new Set<(commands: readonly CommandEntry[]) => void>();
  const list = () => [...live.values()].map((l) => l.entry);
  function notify() {
    const commands = list();
    for (const listener of [...listeners]) {
      try {
        listener(commands);
      } catch (error) {
        console.error("[system.commands] a catalogue listener threw:", error);
      }
    }
  }

  function liveOf(extension: Extension, entry: CommandEntry): Live {
    const declaration = Command.required(entry.id)
      .input(jsonStandardSchema(entry.input))
      .output(jsonStandardSchema(entry.output ?? true))
      .build();
    const reference = extension.reference;
    const context: CommandContext = { command: entry.id };
    const unlisten = reference
      ? substrate.listen(declaration, (cmd) => reference.call(cmd.payload, context))
      : undefined;
    return { entry, declaration, unlisten };
  }

  /**
   * Make the live commands those of `extensions`, the first extension per command id winning:
   * a record whose extension is still the winner is kept, so a duplicate takes over when the
   * extension before it leaves. Returns whether anything changed.
   */
  function sync(extensions: readonly Extension[]): boolean {
    const next = new Map<string, Live>();
    let changed = false;
    for (const extension of extensions) {
      const entry = entryOf(extension);
      if (next.has(entry.id)) continue;
      const kept = live.get(entry.id);
      if (kept?.entry.extension === extension) next.set(entry.id, kept);
      else {
        next.set(entry.id, liveOf(extension, entry));
        changed = true;
      }
    }
    for (const [id, record] of live) {
      if (next.get(id) === record) continue;
      record.unlisten?.();
      changed = true;
    }
    if (!changed) return false;
    live.clear();
    for (const [id, record] of next) live.set(id, record);
    return true;
  }

  const bus: CommandBus = {
    async call<T>(id: string, input?: unknown, callOptions?: CallOptions): Promise<T> {
      const found = live.get(id);
      if (!found) throw new CommandCallError("unknown-command", id);
      const caller = callOptions?.caller;
      let payload = input ?? {};
      if (!isUser(caller)) {
        // The gate decides on a copy the caller cannot change while it waits (an approval), and
        // that copy is what runs.
        try {
          payload = structuredClone(payload);
        } catch (error) {
          throw new CommandCallError("invalid-input", id, {
            message: `invalid-input: ${id}: the input cannot be copied`,
            cause: error,
            issues: ["the input is not plain data"],
          });
        }
        if (!gate)
          throw new CommandCallError("forbidden", id, {
            message: `forbidden: ${id}: no gate decides calls from callers other than the user`,
          });
        try {
          await gate({
            command: found.entry,
            caller: caller as Exclude<Caller, { kind: "user" }>,
            input: payload,
          });
        } catch (error) {
          throw new CommandCallError("forbidden", id, {
            message: error instanceof Error ? error.message : `forbidden: ${id}`,
            cause: error,
          });
        }
        // The command may have left while the gate waited.
        if (live.get(id) !== found) throw new CommandCallError("unknown-command", id);
      }
      try {
        return (await substrate.call(found.declaration, payload).promise) as T;
      } catch (error) {
        throw callError(found.entry, error);
      }
    },
    list,
    keybindings: () => keybindings,
    get: (id) => live.get(id)?.entry,
    observe(listener) {
      const own = (commands: readonly CommandEntry[]) => listener(commands);
      listeners.add(own);
      own(list());
      return () => {
        listeners.delete(own);
      };
    },
  };

  return {
    bus,
    activate(context) {
      const stop = context.extensions.observe(COMMANDS_POINT, (all) => {
        if (sync(all)) notify();
      });
      const stopKeys = context.extensions.observe(KEYBINDINGS_POINT, (all, { added, removed }) => {
        keybindings = all.map((e) => ({
          ...(e.data as Omit<Keybinding, "fragment">),
          fragment: e.contributor,
        }));
        if (added.length > 0 || removed.length > 0) notify();
      });
      return () => {
        stop();
        stopKeys();
        keybindings = [];
        for (const l of live.values()) l.unlisten?.();
        live.clear();
        notify();
      };
    },
  };
}

/** The issues a Standard Schema validator reported (the substrate's `cause`), one line each. */
function issuesOf(cause: unknown): string[] {
  return Array.isArray(cause) ? cause.map((i: { message?: unknown }) => String(i?.message)) : [];
}

/** The typed error for a rejection of the substrate's call. */
function callError(entry: CommandEntry, error: unknown): CommandCallError {
  const id = entry.id;
  if (!(error instanceof CommandError))
    return new CommandCallError("handler-error", id, { cause: error });
  switch (error.kind) {
    case "input-validation":
      return new CommandCallError("invalid-input", id, {
        cause: error.cause,
        issues: issuesOf(error.cause),
      });
    case "output-validation":
      return new CommandCallError("invalid-output", id, {
        cause: error.cause,
        issues: issuesOf(error.cause),
      });
    case "no-handlers":
    case "not-claimed":
      return new CommandCallError("no-handler", id, { cause: error });
    case "listener-threw":
      return thrownError(entry, error.cause);
  }
}

/** The typed error for what a handler threw. */
function thrownError(entry: CommandEntry, thrown: unknown): CommandCallError {
  if (thrown instanceof ExtensionUnavailable)
    return new CommandCallError("unavailable", entry.id, { cause: thrown });
  if (isCommandFailure(thrown)) {
    const body: Record<string, unknown> = { code: thrown.code, message: thrown.message };
    if (thrown.data !== undefined) body.data = thrown.data;
    for (const declared of entry.errors) {
      if (!declared.codes.includes(thrown.code)) continue;
      if (jsonValidator(declared.schema)(body).length > 0) continue;
      return new CommandCallError("declared-error", entry.id, {
        message: thrown.message,
        cause: thrown,
        code: thrown.code,
        status: declared.status,
        data: thrown.data,
      });
    }
  }
  return new CommandCallError("handler-error", entry.id, { cause: thrown });
}
