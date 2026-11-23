// The public state system.security publishes on the kernel's slot bus.
import { defineKeyedSlot } from "@statewalker/shared-slots";
import type { Principal } from "./capabilities.js";
import type { ActionKind } from "./policy.js";

/** An extension to `capabilities` that system.security refused. */
export interface CapabilityRefusal {
  /** The extension's id (`<contributor>#<n>`, or the runtime contribution's key). */
  readonly id: string;
  readonly contributor: string;
  readonly point: string;
  /** `not-system-code`: only `system.` fragments may grant. */
  readonly code: "not-system-code";
  readonly message: string;
}

/** Refused extensions to `capabilities`, by extension id (`system:security:refused`). */
export const capabilityRefusalsSlot = defineKeyedSlot<CapabilityRefusal>("system:security:refused");

/** A call suspended until the user answers, as published for the views that show approvals. */
export interface ApprovalRequest {
  /** The id to answer it by. */
  readonly id: string;
  readonly principal: Principal;
  /** The command's identity, `<fragment-id>/<command-id>`. */
  readonly command: string;
  readonly action: ActionKind;
  /** The permission the call uses, `tools.use:<command>`. */
  readonly permission: string;
  /** The call's input, as given (not yet checked against the command's schema). */
  readonly input: unknown;
  /** Why the policy asks. */
  readonly reason: string;
}

/** Calls waiting on the user's answer, by approval id (`system:security:approvals`). */
export const approvalsSlot = defineKeyedSlot<ApprovalRequest>("system:security:approvals");
