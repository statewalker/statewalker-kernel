// Capabilities as Biscuit tokens (webrun-biscuit), on the AI harness's model (statewalker-ai
// `ai-access`, `capabilities.ts`): system.security holds the root key and signs one token per
// principal; the token's authority block names the principal and its rights, and a holder can
// only narrow it (attenuation blocks add checks; facts they add are never trusted by the
// authorizer). The root key never leaves this module.
import {
  Biscuit,
  generateKeypair,
  type Keypair,
  type VerifiedBiscuit,
} from "@statewalker/webrun-biscuit";
import { PERMISSION_PATTERN } from "./archive.js";

/** The kinds of principal that hold capabilities. The user holds none: their calls are not gated. */
export type PrincipalKind = "agent" | "peer" | "sandbox";

/** Who a capability is issued to: an agent session, a peer, a sandbox. */
export interface Principal {
  readonly kind: PrincipalKind;
  /** The session's, peer's or sandbox's id. */
  readonly id: string;
}

/** What a capability carries besides its principal. */
export interface Grant {
  /** The permissions granted, each `tools.use:<fragment-id>/<command-id>`. None by default. */
  readonly permissions?: readonly string[];
  /**
   * Issued for a context nobody attends (a schedule, a headless run): every Ask is refused.
   * Fixed in the token, so no later block can undo it.
   */
  readonly unattended?: boolean;
}

/** What a verified capability says. */
export interface CapabilityClaims {
  readonly principal: Principal;
  readonly unattended: boolean;
  /** The revocation ids of the token's blocks, the authority block's first. */
  readonly revocationIds: readonly string[];
}

const KINDS: readonly PrincipalKind[] = ["agent", "peer", "sandbox"];

/** The issuer: the root key, signing and verifying. */
export interface Issuer {
  issue(principal: Principal, grant?: Grant): string;
  /**
   * The revocation ids of a token this issuer signed, from its signature chain alone (no Datalog
   * is evaluated, so no holder-written block can make it fail); throws for any other token.
   */
  revocationIds(token: string): readonly string[];
  /** The verified token and its claims; throws for a token this issuer did not sign. */
  verify(token: string): { token: VerifiedBiscuit; claims: CapabilityClaims };
}

/**
 * Bounds for evaluating a token's Datalog: its holder writes the attenuation blocks, so they
 * must not buy unbounded work (webrun-biscuit's own default is a whole second).
 */
export const RUN_LIMITS = { maxFacts: 1000, maxIterations: 100, maxTimeMs: 100 } as const;

const PERMISSION = new RegExp(PERMISSION_PATTERN);

export function createIssuer(keys: Keypair = generateKeypair()): Issuer {
  return {
    issue(principal, grant = {}) {
      if (!KINDS.includes(principal.kind))
        throw new TypeError(`no principal kind "${String(principal.kind)}"`);
      if (typeof principal.id !== "string" || principal.id === "")
        throw new TypeError("a principal has an id");
      const params: Record<string, string> = { kind: principal.kind, id: principal.id };
      const lines = ["principal({kind}, {id});"];
      (grant.permissions ?? []).forEach((permission, n) => {
        if (typeof permission !== "string" || !PERMISSION.test(permission))
          throw new TypeError(`not a permission: "${String(permission)}"`);
        params[`p${n}`] = permission;
        lines.push(`right({p${n}});`);
      });
      if (grant.unattended) lines.push("unattended(true);");
      return Biscuit.build(keys.secretKey, lines.join("\n"), { params }).toBase64();
    },
    revocationIds(text) {
      return Biscuit.fromBase64(text).verify(keys.publicKey).revocationIds;
    },
    verify(text) {
      const token = Biscuit.fromBase64(text).verify(keys.publicKey);
      const evaluation = token.evaluate("allow if true;", { limits: RUN_LIMITS });
      const principals = evaluation.query("p($k, $i) <- principal($k, $i)");
      const [found] = principals;
      if (principals.length !== 1 || !found) throw new Error("a capability names one principal");
      const [kind, id] = found.terms.map((t) => (t as { v?: unknown }).v);
      if (!KINDS.includes(kind as PrincipalKind) || typeof id !== "string")
        throw new Error("a capability names one principal");
      const unattended = evaluation.query("u($x) <- unattended($x)").length > 0;
      return {
        token,
        claims: {
          principal: { kind: kind as PrincipalKind, id },
          unattended,
          revocationIds: token.revocationIds,
        },
      };
    },
  };
}
