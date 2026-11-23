import {
  type Catalog,
  type ComponentApi,
  type MessageProcessor,
  mapErrorToRendererMessage,
  type RendererErrorMessage,
  type SurfaceModel,
} from "@a2ui/web_core";
import type { ActivationContext, Extension } from "@statewalker/kernel.core";
import {
  type ActionRequest,
  type CallerCapability,
  type CommandCaller,
  createActionRouter,
  type LogEntry,
  type PolicyDecision,
} from "./actions.js";
import { CATALOG_POINT } from "./archive.js";
import { BASIC_COMPONENTS, buildCatalog, PLATFORM_CATALOG_ID } from "./catalog.js";
import { type ComponentDefinition, isComponentDefinition } from "./define-component.js";
import { createProcessor } from "./processor.js";
import { isV09Message, upgradeV09Message } from "./shim-v09.js";

/** Who sent a surface. Only agents' surfaces pass Allow/Ask/Block on their events. */
export type SurfaceOrigin = "agent" | "server" | "user";

/** Where a surface shows: inline where its sender placed it, or popped out into the dock. */
export type SurfacePlacement = "inline" | "docked";

export interface SurfaceInfo {
  readonly id: string;
  readonly origin: SurfaceOrigin;
  readonly title: string;
  readonly placement: SurfacePlacement;
}

/** Why a contribution to `catalog` was not taken into the catalog. */
export interface CatalogRefusal {
  readonly name: string;
  readonly contributor: string;
  readonly reason:
    | "unavailable"
    | "not-a-definition"
    | "name-mismatch"
    | "reserved-name"
    | "duplicate";
  readonly message: string;
}

export interface ProcessOptions {
  readonly origin: SurfaceOrigin;
  /** The title of the surfaces these messages create (their tab when docked). */
  readonly title?: string;
  /**
   * The caller the surfaces' events run as on the bus: an agent's capability, so
   * system.security's gate checks its grants and the user's Allow/Ask/Block. Kept with each
   * surface these messages create.
   */
  readonly caller?: CallerCapability;
}

export interface ProcessResult {
  /** The surfaces these messages created. */
  readonly surfaceIds: readonly string[];
  /** web_core's error messages (as A2UI sends them back), and the model's own refusals. */
  readonly errors: readonly RendererErrorMessage[];
}

export interface A2uiState {
  readonly components: readonly ComponentDefinition[];
  readonly surfaces: readonly SurfaceInfo[];
}

/** The commands system.workbench runs to dock a surface and to take it back. */
export const OPEN_SURFACE_COMMAND = "system.workbench/open-surface";
export const CLOSE_SURFACE_COMMAND = "system.workbench/close-surface";

/** The A2UI model: the catalog, and the surfaces rendered from it. */
export interface A2ui {
  readonly catalogId: string;
  /** The contributed components in the catalog, in the point's order. */
  components(): readonly ComponentDefinition[];
  /** The catalog new surfaces are validated against: the basic components plus ours. */
  catalog(): Catalog<ComponentApi>;
  /** Contributions to `catalog` that were not taken. */
  refusals(): readonly CatalogRefusal[];
  /** Settles once the catalog follows the point (its references resolved). */
  ready(): Promise<void>;
  /**
   * Process A2UI messages (1.0; 0.9/0.9.1 through the shim) from one sender. Strict: input the
   * catalog does not declare is refused, a surface whose creation fails is not kept, and a
   * message for another sender's surface is refused.
   */
  process(messages: unknown, options: ProcessOptions): Promise<ProcessResult>;
  surface(id: string): SurfaceModel | undefined;
  surfaces(): readonly SurfaceInfo[];
  /** Remove a surface. */
  delete(id: string): void;
  /** Pop a surface out into the dock (`system.workbench/open-surface`). */
  popOut(id: string): Promise<void>;
  /** Take a docked surface back inline (`system.workbench/close-surface`). */
  popIn(id: string): Promise<void>;
  /** Record where a surface shows; the dock calls it when it opens or closes the surface. */
  setDocked(id: string, docked: boolean): void;
  /**
   * Follow the surfaces that go (deleted by their sender, removed with `delete`, or all of them
   * when the fragment deactivates); the dock drops each. Returns a disposer.
   */
  onRemoved(listener: (surfaceId: string) => void): () => void;
  /** Called at once, then after every change to the components or the surfaces. */
  observe(listener: (state: A2uiState) => void): () => void;
  /** What became of each component event. */
  readonly log: readonly LogEntry[];
}

export interface SystemA2uiOptions {
  /** The command bus events run on, and the dock is reached through. */
  readonly commands?: CommandCaller;
  /** Allow/Ask/Block for an agent surface's event. Default: ask. */
  readonly policy?: (req: ActionRequest) => PolicyDecision;
  /** Asked for an event the policy says to ask about. Default: deny. */
  readonly approve?: (req: ActionRequest) => Promise<boolean>;
  /** 0.9/0.9.1 catalog ids and the 1.0 catalog id each stands for. */
  readonly legacyCatalogIds?: Readonly<Record<string, string>>;
  readonly onLog?: (entry: LogEntry) => void;
  /** Actions no component declared (agent-wired Buttons), for the surface's sender. */
  readonly onAction?: (action: { surfaceId: string; name: string; context: unknown }) => void;
}

export interface SystemA2ui {
  readonly a2ui: A2ui;
  /** Activate the client aspect: follow the `catalog` point. Returns the cleanup. */
  activate(context: ActivationContext): () => void;
}

/** Why the model refused a request. */
export class A2uiError extends Error {
  override readonly name = "A2uiError";
  constructor(
    readonly kind: "unknown-surface" | "no-commands",
    readonly surfaceId: string,
  ) {
    super(
      kind === "unknown-surface"
        ? `no surface ${surfaceId}`
        : `no command bus to move the surface ${surfaceId} with`,
    );
  }
}

interface SurfaceEntry {
  readonly id: string;
  readonly origin: SurfaceOrigin;
  readonly title: string;
  readonly caller?: CallerCapability;
  readonly processor: MessageProcessor;
  placement: SurfacePlacement;
}

const ENVELOPES = ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"];

function surfaceIdOf(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  for (const key of ENVELOPES) {
    const body = (message as Record<string, unknown>)[key];
    if (body && typeof body === "object") {
      const id = (body as { surfaceId?: unknown }).surfaceId;
      return typeof id === "string" ? id : undefined;
    }
  }
  return undefined;
}

const refusal = (message: string, surfaceId?: string) =>
  mapErrorToRendererMessage(new Error(message), { surfaceId });

export function createSystemA2ui(options: SystemA2uiOptions = {}): SystemA2ui {
  let definitions: readonly ComponentDefinition[] = [];
  let refused: readonly CatalogRefusal[] = [];
  let catalog = buildCatalog({
    catalogId: PLATFORM_CATALOG_ID,
    basic: BASIC_COMPONENTS,
    components: [],
  });
  const entries = new Map<string, SurfaceEntry>();
  const listeners = new Set<(state: A2uiState) => void>();
  const removedListeners = new Set<(surfaceId: string) => void>();
  let pending: Promise<void> = Promise.resolve();
  let generation = 0;

  const info = (e: SurfaceEntry): SurfaceInfo => ({
    id: e.id,
    origin: e.origin,
    title: e.title,
    placement: e.placement,
  });
  const state = (): A2uiState => ({
    components: definitions,
    surfaces: [...entries.values()].map(info),
  });
  function notify() {
    const current = state();
    for (const listener of [...listeners]) {
      try {
        listener(current);
      } catch (error) {
        console.error("[system.a2ui] a listener threw:", error);
      }
    }
  }

  const router = createActionRouter({
    commands: {
      call: (id, input, callOptions) =>
        !options.commands
          ? Promise.reject(new Error(`no command bus to run ${id} on`))
          : callOptions
            ? options.commands.call(id, input, callOptions)
            : options.commands.call(id, input),
    },
    callerOf: (id) => entries.get(id)?.caller,
    components: () => definitions,
    surface: (id) => entries.get(id)?.processor.getSurface(id),
    isAgentSurface: (id) =>
      entries.get(id)?.origin !== "server" && entries.get(id)?.origin !== "user",
    policy: options.policy ?? (() => "ask"),
    approve: options.approve ?? (async () => false),
    onLog: options.onLog,
    onUnrouted: (a) =>
      options.onAction?.({ surfaceId: a.surfaceId, name: a.name, context: a.context }),
  });

  function setCatalog(next: readonly ComponentDefinition[], refusals: readonly CatalogRefusal[]) {
    definitions = Object.freeze([...next]);
    refused = Object.freeze([...refusals]);
    catalog = buildCatalog({
      catalogId: PLATFORM_CATALOG_ID,
      basic: BASIC_COMPONENTS,
      components: definitions,
    });
    notify();
  }

  async function sync(extensions: readonly Extension[]): Promise<void> {
    const gen = ++generation;
    const resolved = await Promise.all(
      extensions.map(async (extension) => {
        try {
          return { extension, value: await extension.reference?.resolve() };
        } catch (error) {
          return { extension, error };
        }
      }),
    );
    if (gen !== generation) return; // a newer change superseded this one
    const next: ComponentDefinition[] = [];
    const refusals: CatalogRefusal[] = [];
    for (const { extension, value, error } of resolved as {
      extension: Extension;
      value?: unknown;
      error?: unknown;
    }[]) {
      const name = (extension.data as { name: string }).name;
      const refuse = (reason: CatalogRefusal["reason"], message: string) =>
        refusals.push({ name, contributor: extension.contributor, reason, message });
      if (error !== undefined || !extension.reference)
        refuse("unavailable", `the definition of ${name} did not load: ${String(error)}`);
      else if (!isComponentDefinition(value))
        refuse("not-a-definition", `${name} does not reference a defineComponent definition`);
      else if (value.name !== name)
        refuse("name-mismatch", `${name} references the definition of ${value.name}`);
      else if ((BASIC_COMPONENTS as readonly string[]).includes(name))
        refuse("reserved-name", `${name} is a basic component`);
      else if (next.some((d) => d.name === name))
        refuse("duplicate", `${name} is contributed already`);
      else next.push(value);
    }
    setCatalog(next, refusals);
  }

  /** Tell the followers a surface went, so the dock drops it. */
  function removed(id: string) {
    for (const listener of [...removedListeners]) {
      try {
        listener(id);
      } catch (error) {
        console.error("[system.a2ui] a removal listener threw:", error);
      }
    }
  }

  function remove(id: string) {
    const entry = entries.get(id);
    if (!entry) return;
    entries.delete(id);
    entry.processor.dispose();
    removed(id);
    notify();
  }

  async function process(
    messages: unknown,
    { origin, title, caller }: ProcessOptions,
  ): Promise<ProcessResult> {
    await pending;
    const list = (Array.isArray(messages) ? messages : [messages]).map((m) =>
      isV09Message(m)
        ? upgradeV09Message(m as Record<string, unknown>, {
            catalogIds: { ...(options.legacyCatalogIds ?? {}) },
          })
        : m,
    );
    // Consecutive messages to one surface go to its processor in one batch.
    const groups: { surfaceId?: string; messages: unknown[] }[] = [];
    for (const message of list) {
      const surfaceId = surfaceIdOf(message);
      const last = groups.at(-1);
      const creates = !!(message as { createSurface?: unknown })?.createSurface;
      if (last && last.surfaceId === surfaceId && !creates) last.messages.push(message);
      else groups.push({ surfaceId, messages: [message] });
    }
    const surfaceIds: string[] = [];
    const errors: RendererErrorMessage[] = [];
    let changed = false;
    for (const { surfaceId, messages: batch } of groups) {
      if (surfaceId === undefined) {
        errors.push(refusal("not an A2UI 1.0 surface message"));
        continue;
      }
      const existing = entries.get(surfaceId);
      const creates = !!(batch[0] as { createSurface?: unknown }).createSurface;
      if (creates) {
        if (existing) {
          errors.push(refusal(`the surface ${surfaceId} exists already`, surfaceId));
          continue;
        }
        const processor = createProcessor([catalog], router.handle);
        const found = processor.processMessagesWithErrors(batch);
        const surface = processor.getSurface(surfaceId);
        if (found.length > 0 || !surface) {
          // Fail closed: a surface whose creation was refused in part is not shown at all.
          errors.push(...found);
          processor.dispose();
          continue;
        }
        entries.set(surfaceId, {
          id: surfaceId,
          origin,
          title: title ?? surfaceId,
          ...(caller ? { caller } : {}),
          processor,
          placement: "inline",
        });
        surfaceIds.push(surfaceId);
        changed = true;
        continue;
      }
      if (!existing) {
        errors.push(refusal(`no surface ${surfaceId}`, surfaceId));
        continue;
      }
      if (existing.origin !== origin) {
        errors.push(refusal(`the surface ${surfaceId} was sent by another origin`, surfaceId));
        continue;
      }
      errors.push(...existing.processor.processMessagesWithErrors(batch));
      if (!existing.processor.getSurface(surfaceId)) {
        entries.delete(surfaceId); // deleteSurface
        existing.processor.dispose();
        removed(surfaceId);
        changed = true;
      }
    }
    if (changed) notify();
    return { surfaceIds, errors };
  }

  async function move(id: string, command: string, input: Record<string, unknown>) {
    if (!entries.has(id)) throw new A2uiError("unknown-surface", id);
    if (!options.commands) throw new A2uiError("no-commands", id);
    await options.commands.call(command, input);
  }

  const a2ui: A2ui = {
    catalogId: PLATFORM_CATALOG_ID,
    components: () => definitions,
    catalog: () => catalog,
    refusals: () => refused,
    ready: () => pending,
    process,
    surface: (id) => entries.get(id)?.processor.getSurface(id),
    surfaces: () => [...entries.values()].map(info),
    delete: remove,
    popOut: (id) =>
      move(id, OPEN_SURFACE_COMMAND, { surfaceId: id, title: entries.get(id)?.title }),
    popIn: (id) => move(id, CLOSE_SURFACE_COMMAND, { surfaceId: id }),
    setDocked(id, docked) {
      const entry = entries.get(id);
      const placement: SurfacePlacement = docked ? "docked" : "inline";
      if (!entry || entry.placement === placement) return;
      entry.placement = placement;
      notify();
    },
    onRemoved(listener) {
      const own = (id: string) => listener(id);
      removedListeners.add(own);
      return () => {
        removedListeners.delete(own);
      };
    },
    observe(listener) {
      const own = (s: A2uiState) => listener(s);
      listeners.add(own);
      own(state());
      return () => {
        listeners.delete(own);
      };
    },
    log: router.log,
  };

  return {
    a2ui,
    activate(context) {
      const stop = context.extensions.observe(CATALOG_POINT, (all) => {
        pending = sync(all);
      });
      return () => {
        stop();
        generation++;
        pending = Promise.resolve();
        for (const id of [...entries.keys()]) remove(id);
        setCatalog([], []);
      };
    },
  };
}
