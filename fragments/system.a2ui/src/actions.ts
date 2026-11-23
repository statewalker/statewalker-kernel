import type { ActionPayload, MessageProcessor, SurfaceModel } from "@a2ui/web_core";
import type { CatalogComponent } from "./define-component.js";

export type PolicyDecision = "allow" | "ask" | "block";
export type Outcome = "ran" | "failed" | "asking" | "denied" | "blocked" | "invalid" | "unrouted";

/** What a command runs on: the shape of system.commands' bus. */
export interface CommandCaller {
  call(id: string, input?: unknown): Promise<unknown>;
}

export interface ActionRequest {
  readonly surfaceId: string;
  readonly componentId: string;
  readonly componentType: string;
  readonly event: string;
  /** The command the event maps to, `<fragment-id>/<command-id>`. */
  readonly command: string;
  readonly payload: unknown;
}

export interface LogEntry {
  readonly at: string;
  readonly outcome: Outcome;
  readonly event: string;
  readonly surfaceId: string;
  readonly componentId: string;
  readonly command?: string;
  readonly detail?: unknown;
}

export interface ActionRouterOptions {
  readonly commands: CommandCaller;
  /** The catalog's components, or a function giving the live ones. */
  readonly components: readonly CatalogComponent[] | (() => readonly CatalogComponent[]);
  readonly isAgentSurface: (surfaceId: string) => boolean;
  /** Allow/Ask/Block for an agent surface's action. */
  readonly policy: (req: ActionRequest) => PolicyDecision;
  readonly approve: (req: ActionRequest) => Promise<boolean>;
  /** The surface an action came from; set by `attach` too. */
  readonly surface?: (surfaceId: string) => SurfaceModel | undefined;
  readonly onLog?: (entry: LogEntry) => void;
  /** An action no component declared (an agent-wired Button's): for the surface's sender. */
  readonly onUnrouted?: (action: ActionPayload) => void;
}

export interface ActionRouter {
  readonly log: readonly LogEntry[];
  /** web_core's action handler. Never blocks dispatch while an approval is pending. */
  handle(action: ActionPayload): void;
  /** Route the actions of this processor's surfaces. */
  attach(processor: MessageProcessor): void;
}

/**
 * Routes surface actions to platform commands. The component type comes from the surface model
 * (never from the payload), and only events a component declared with a command mapping reach
 * the bus, after their payload passed the event's Zod schema. Agent surfaces pass the
 * Allow/Ask/Block policy.
 */
export function createActionRouter(opts: ActionRouterOptions): ActionRouter {
  const components = () =>
    typeof opts.components === "function" ? opts.components() : opts.components;
  const log: LogEntry[] = [];
  let surfaceOf = opts.surface;
  const record = (a: ActionPayload, outcome: Outcome, command?: string, detail?: unknown) => {
    const entry: LogEntry = {
      at: new Date().toISOString(),
      outcome,
      event: a.name,
      surfaceId: a.surfaceId,
      componentId: a.sourceComponentId,
      command,
      detail,
    };
    log.push(entry);
    opts.onLog?.(entry);
  };

  async function handle(a: ActionPayload): Promise<void> {
    const model = surfaceOf?.(a.surfaceId)?.componentsModel.get(a.sourceComponentId);
    const def = model ? components().find((c) => c.name === model.type) : undefined;
    const command =
      def?.commands && Object.hasOwn(def.commands, a.name) ? def.commands[a.name] : undefined;
    const schema =
      def?.events && Object.hasOwn(def.events.shape, a.name) ? def.events.shape[a.name] : undefined;
    if (!model || !def || !command || !schema) {
      record(a, "unrouted");
      opts.onUnrouted?.(a);
      return;
    }
    const parsed = schema.safeParse(a.context);
    if (!parsed.success) return record(a, "invalid", command, parsed.error.issues);
    const req: ActionRequest = {
      surfaceId: a.surfaceId,
      componentId: a.sourceComponentId,
      componentType: model.type,
      event: a.name,
      command,
      payload: parsed.data,
    };
    if (opts.isAgentSurface(a.surfaceId)) {
      let decision: PolicyDecision;
      try {
        decision = opts.policy(req);
      } catch {
        decision = "block";
      }
      if (decision !== "allow" && decision !== "ask") return record(a, "blocked", command);
      if (decision === "ask") {
        record(a, "asking", command);
        let approved = false;
        try {
          approved = (await opts.approve(req)) === true;
        } catch {
          approved = false;
        }
        if (!approved) return record(a, "denied", command);
      }
    }
    try {
      const result = await opts.commands.call(command, parsed.data);
      record(a, "ran", command, result);
    } catch (e) {
      record(a, "failed", command, String(e));
    }
  }

  return {
    log,
    handle: (a) => {
      void handle(a);
    },
    attach(p) {
      surfaceOf = (id) => p.getSurface(id);
    },
  };
}
