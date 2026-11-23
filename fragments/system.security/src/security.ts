import { type ActivationContext, type Extension, isSystemId } from "@statewalker/kernel.core";
import type { Slots } from "@statewalker/shared-slots";
import type { CallGate, CallRequest } from "@statewalker/system.commands";
import { toolPermission } from "@statewalker/system.commands";
import { CAPABILITIES_POINT } from "./archive.js";
import {
  createIssuer,
  type Grant,
  type Issuer,
  type Principal,
  RUN_LIMITS,
} from "./capabilities.js";
import { type ActionKind, decide, type Policy } from "./policy.js";
import { type ApprovalRequest, approvalsSlot, capabilityRefusalsSlot } from "./slots.js";

interface Waiting {
  readonly request: ApprovalRequest;
  /** The revocation ids of the capability the call presented. */
  readonly revocationIds: readonly string[];
  settle(answer: Answer, reason?: string): void;
}

/** A standing grant from system code, as declared on the `capabilities` point. */
interface StandingGrant {
  readonly principals: readonly string[];
  readonly permissions: readonly string[];
}

export interface SystemSecurityOptions {
  /** The kernel's slot bus, where approvals and refusals are published. */
  readonly slots?: Slots;
  /**
   * Whether someone attends to answer approvals (a shell with the user present). Off by default:
   * a headless host refuses every call the policy asks about.
   */
  readonly attended?: boolean;
}

/** The user's answer to an approval request. */
export type Answer = "allow" | "deny";

/** The system.security fragment's code. Only system code (the host) holds it. */
export interface SystemSecurity {
  /** Issue a capability to `principal`: a token naming it and the permissions granted. */
  issue(principal: Principal, grant?: Grant): string;
  /**
   * Revoke a capability: every later call presenting it, or a token narrowed from it, is
   * refused (a call already let through runs on). Returns false for a token this fragment did
   * not issue.
   */
  revoke(capability: string): boolean;
  /** The user's policy. */
  policy(): Policy;
  setPolicy(policy: Policy): void;
  /** The approval requests waiting on the user's answer (also published in `approvalsSlot`). */
  approvals(): readonly ApprovalRequest[];
  /**
   * Answer the approval request `id`: the suspended call proceeds (`allow`) or is refused
   * (`deny`). Returns whether such a request was waiting.
   */
  answer(id: string, answer: Answer): boolean;
  /** The gate system.commands calls for every call from a caller other than the user. */
  readonly gate: CallGate;
  /** Activate the client aspect: follow the `capabilities` point. Returns the cleanup. */
  activate(context: ActivationContext): () => void;
}

/** Why system.security refused a call. */
export class SecurityRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityRefusal";
  }
}

/** A deep copy of plain data, frozen throughout. */
function frozenCopy<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (v: unknown) => {
    if (typeof v !== "object" || v === null || Object.isFrozen(v)) return;
    Object.freeze(v);
    for (const key of Reflect.ownKeys(v)) freeze((v as Record<PropertyKey, unknown>)[key]);
  };
  freeze(copy);
  return copy;
}

/** Whether `id` is a static extension's id, `<contributor>#<n>` (runtime ones are `<contributor>/<name>`). */
function isStaticId(id: string, contributor: string): boolean {
  if (!id.startsWith(`${contributor}#`)) return false;
  return /^[0-9]+$/.test(id.slice(contributor.length + 1));
}

export function createSystemSecurity(options: SystemSecurityOptions = {}): SystemSecurity {
  const { slots, attended = false } = options;
  const waiting = new Map<string, Waiting>();
  const issuer: Issuer = createIssuer();
  let policy: Policy = {};
  let active = false;
  let standing: readonly StandingGrant[] = [];
  const revoked = new Set<string>();
  const refusals = new Map<string, () => void>();
  const isRevoked = (ids: readonly string[]) => ids.some((id) => revoked.has(id));

  /**
   * Keep the static extensions of system fragments; refuse (and publish) every other one. Only a
   * static extension's contributor is the kernel's word (its id is `<contributor>#<n>`, from the
   * fragment's own aspect file); a runtime contribution names its contributor itself, so it is
   * refused whatever it claims.
   */
  function follow(extensions: readonly Extension[]) {
    const kept: StandingGrant[] = [];
    const refused = new Set<string>();
    for (const extension of extensions) {
      const isStatic = isStaticId(extension.id, extension.contributor);
      if (isStatic && isSystemId(extension.contributor)) {
        kept.push(extension.data as StandingGrant);
        continue;
      }
      refused.add(extension.id);
      if (refusals.has(extension.id) || !slots) continue;
      const dispose = slots.register(
        capabilityRefusalsSlot,
        extension.id,
        isStatic
          ? {
              id: extension.id,
              contributor: extension.contributor,
              point: extension.point,
              code: "not-system-code",
              message: `"${extension.id}": only system code grants capabilities; ${extension.contributor} is a fragment`,
            }
          : {
              id: extension.id,
              contributor: extension.contributor,
              point: extension.point,
              code: "runtime-contribution",
              message: `"${extension.id}": a runtime contribution cannot grant capabilities; only a system fragment's own aspect file can`,
            },
      );
      refusals.set(extension.id, dispose);
    }
    for (const [id, dispose] of refusals) {
      if (refused.has(id)) continue;
      dispose();
      refusals.delete(id);
    }
    standing = kept;
  }

  function clearRefusals() {
    for (const dispose of refusals.values()) dispose();
    refusals.clear();
  }

  /** Suspend until the user answers `request`; resolves on allow, rejects on deny. */
  function ask(request: ApprovalRequest, revocationIds: readonly string[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const unpublish = slots?.register(approvalsSlot, request.id, request);
      waiting.set(request.id, {
        request,
        revocationIds,
        settle(answer, reason) {
          waiting.delete(request.id);
          unpublish?.();
          if (answer === "allow") resolve();
          else
            reject(
              new SecurityRefusal(`refused ${request.command}: ${reason ?? "the user denied it"}`),
            );
        },
      });
    });
  }

  async function gate({ command, caller, input }: CallRequest): Promise<void> {
    if (!active) throw new SecurityRefusal(`refused ${command.id}: system.security is not active`);
    let verified: ReturnType<Issuer["verify"]>;
    try {
      verified = issuer.verify(caller.capability);
    } catch {
      throw new SecurityRefusal(`refused ${command.id}: not a capability system code issued`);
    }
    if (isRevoked(verified.claims.revocationIds))
      throw new SecurityRefusal(`refused ${command.id}: the capability is revoked`);
    const { principal } = verified.claims;
    if (principal.kind === "agent" && !command.exposures.agent)
      throw new SecurityRefusal(`refused ${command.id}: its fragment does not expose it to agents`);
    if (principal.kind === "peer" && !command.exposures.http)
      throw new SecurityRefusal(`refused ${command.id}: its fragment does not expose it over HTTP`);
    const permission = toolPermission(command.id);
    // The facts a holder's checks may test: the command called and the permission it needs;
    // the standing grants of system code to the principal's kind are the authorizer's rights.
    const kind = principal.kind;
    const params: Record<string, string> = { command: command.id, permission };
    const lines = ["command({command});", "permission({permission});"];
    let n = 0;
    for (const grant of standing) {
      if (!grant.principals.includes(kind)) continue;
      for (const granted of grant.permissions) {
        params[`s${n}`] = granted;
        lines.push(`right({s${n}});`);
        n++;
      }
    }
    lines.push("allow if right({permission});");
    const result = verified.token.authorize(lines.join("\n"), { params, limits: RUN_LIMITS });
    if (result.kind !== "ok")
      throw new SecurityRefusal(`refused ${command.id}: no grant of ${permission}`);
    const action: ActionKind = command.exposures.agent?.action ?? "admin";
    const decision = decide(policy, command.id, action);
    if (decision.verdict === "allow") return;
    if (decision.verdict === "block")
      throw new SecurityRefusal(`refused ${command.id}: ${decision.reason}`);
    if (!attended || verified.claims.unattended)
      throw new SecurityRefusal(
        `refused ${command.id}: ${decision.reason} asks, and nobody attends to answer`,
      );
    await ask(
      {
        id: `approval-${crypto.randomUUID()}`,
        principal,
        command: command.id,
        action,
        permission,
        // A copy of its own, frozen: the run's input stays private to the bus, so nothing that
        // reads the published request can change what runs after the user saw it.
        input: frozenCopy(input),
        reason: `${decision.reason} asks`,
      },
      verified.claims.revocationIds,
    );
    // What changed while the call waited still counts.
    if (!active) throw new SecurityRefusal(`refused ${command.id}: system.security is not active`);
    if (isRevoked(verified.claims.revocationIds))
      throw new SecurityRefusal(`refused ${command.id}: the capability is revoked`);
  }

  return {
    issue: (principal, grant) => issuer.issue(principal, grant),
    revoke(capability) {
      let ids: readonly string[];
      try {
        ids = issuer.revocationIds(capability);
      } catch {
        return false;
      }
      // The token's own last block: a narrowed token is revoked alone, an issued one with
      // every token narrowed from it.
      const last = ids[ids.length - 1];
      if (last !== undefined) revoked.add(last);
      for (const w of [...waiting.values()])
        if (isRevoked(w.revocationIds)) w.settle("deny", "the capability is revoked");
      return true;
    },
    policy: () => policy,
    approvals: () => [...waiting.values()].map((w) => w.request),
    answer(id, answer) {
      const found = waiting.get(id);
      if (!found || (answer !== "allow" && answer !== "deny")) return false;
      found.settle(answer);
      return true;
    },
    setPolicy(next) {
      policy = next;
    },
    gate,
    activate(context) {
      active = true;
      const stop = context.extensions.observe(CAPABILITIES_POINT, follow);
      return () => {
        active = false;
        stop();
        standing = [];
        clearRefusals();
        for (const w of [...waiting.values()]) w.settle("deny", "system.security deactivated");
      };
    },
  };
}
