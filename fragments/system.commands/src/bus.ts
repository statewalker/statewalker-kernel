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

/** The internal bus: every live command, callable by its identity. */
export interface CommandBus {
  /**
   * Call the command `id` (`<fragment-id>/<command-id>`) with `input`, validated against its
   * input schema; the result is validated against its output schema.
   */
  call<T = unknown>(id: string, input?: unknown): Promise<T>;
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

export function createSystemCommands(): SystemCommands {
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

  function add(extension: Extension) {
    const entry = entryOf(extension);
    if (live.has(entry.id)) return;
    const declaration = Command.required(entry.id)
      .input(jsonStandardSchema(entry.input))
      .output(jsonStandardSchema(entry.output ?? true))
      .build();
    const reference = extension.reference;
    const context: CommandContext = { command: entry.id };
    const unlisten = reference
      ? substrate.listen(declaration, (cmd) => reference.call(cmd.payload, context))
      : undefined;
    live.set(entry.id, { entry, declaration, unlisten });
  }

  function remove(extension: Extension) {
    const id = entryOf(extension).id;
    const found = live.get(id);
    if (found?.entry.extension !== extension) return;
    found.unlisten?.();
    live.delete(id);
  }

  const bus: CommandBus = {
    async call<T>(id: string, input?: unknown): Promise<T> {
      const found = live.get(id);
      if (!found) throw new CommandCallError("unknown-command", id);
      try {
        return (await substrate.call(found.declaration, input ?? {}).promise) as T;
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
      const stop = context.extensions.observe(COMMANDS_POINT, (_all, { added, removed }) => {
        for (const e of removed) remove(e);
        for (const e of added) add(e);
        if (added.length > 0 || removed.length > 0) notify();
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
