import type { ActionPayload, MessageProcessor } from "@a2ui/web_core";
import type { Commands } from "@statewalker/shared-commands";
import type { CatalogComponent } from "./define-component.js";

export type PolicyDecision = "allow" | "ask" | "block";
export type Outcome = "ran" | "failed" | "asking" | "denied" | "blocked" | "invalid" | "unrouted";

export interface ActionRequest {
  surfaceId: string;
  componentId: string;
  componentType: string;
  event: string;
  commandKey: string;
  payload: unknown;
}

export interface LogEntry {
  at: string;
  outcome: Outcome;
  event: string;
  componentId: string;
  commandKey?: string;
  detail?: unknown;
}

/**
 * Routes surface actions to platform commands. The component type comes from the
 * surface model (never from the payload), and only events a component declared
 * with a command mapping reach the bus. Agent surfaces pass the Allow/Ask/Block policy.
 */
export function createActionRouter(opts: {
  commands: Commands;
  components: CatalogComponent[];
  isAgentSurface: (surfaceId: string) => boolean;
  policy: (req: ActionRequest) => PolicyDecision;
  approve: (req: ActionRequest) => Promise<boolean>;
  onLog?: (entry: LogEntry) => void;
}) {
  const byName = new Map(opts.components.map((c) => [c.name, c]));
  const log: LogEntry[] = [];
  let processor: MessageProcessor | undefined;
  const record = (a: ActionPayload, outcome: Outcome, commandKey?: string, detail?: unknown) => {
    const entry = {
      at: new Date().toISOString(),
      outcome,
      event: a.name,
      componentId: a.sourceComponentId,
      commandKey,
      detail,
    };
    log.push(entry);
    opts.onLog?.(entry);
  };

  async function handle(a: ActionPayload): Promise<void> {
    const model = processor?.getSurface(a.surfaceId)?.componentsModel.get(a.sourceComponentId);
    const def = model ? byName.get(model.type) : undefined;
    const decl = def?.commands?.[a.name];
    const schema = def?.events?.shape[a.name];
    if (!model || !def || !decl || !schema) return record(a, "unrouted"); // → would go to the agent
    const parsed = schema.safeParse(a.context);
    if (!parsed.success) return record(a, "invalid", decl.key, parsed.error.issues);
    const req: ActionRequest = {
      surfaceId: a.surfaceId,
      componentId: a.sourceComponentId,
      componentType: model.type,
      event: a.name,
      commandKey: decl.key,
      payload: parsed.data,
    };
    if (opts.isAgentSurface(a.surfaceId)) {
      const decision = opts.policy(req);
      if (decision === "block") return record(a, "blocked", decl.key);
      if (decision === "ask") {
        record(a, "asking", decl.key);
        if (!(await opts.approve(req))) return record(a, "denied", decl.key);
      }
    }
    try {
      const result = await opts.commands.call(decl, parsed.data).promise;
      record(a, "ran", decl.key, result);
    } catch (e) {
      record(a, "failed", decl.key, String(e));
    }
  }

  return {
    log,
    handle: (a: ActionPayload) => {
      void handle(a); // do not block web_core's dispatch while waiting for approval
    },
    attach(p: MessageProcessor) {
      processor = p;
    },
  };
}
