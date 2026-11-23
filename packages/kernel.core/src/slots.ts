import { defineKeyedSlot, type KeyedSlotDeclaration } from "@statewalker/shared-slots";
import type { Aspect, ExtensionReference, InstalledFragment } from "./manifest.js";

/** Fragments installed on this host, by id. */
export const installedFragmentsSlot = defineKeyedSlot<InstalledFragment>(
  "system:fragments:installed",
);

/** Installed fragments the user enabled, by id. */
export const enabledFragmentsSlot = defineKeyedSlot<InstalledFragment>("system:fragments:enabled");

/** Enabled fragments whose requirements are all met, by id. */
export const resolvedFragmentsSlot = defineKeyedSlot<InstalledFragment>(
  "system:fragments:resolved",
);

const activeSlots = new Map<Aspect, KeyedSlotDeclaration<InstalledFragment>>();

/** Resolved fragments whose `aspect` is active, by id (`system:fragments:active:<aspect>`). */
export function activeFragmentsSlot(aspect: Aspect): KeyedSlotDeclaration<InstalledFragment> {
  let decl = activeSlots.get(aspect);
  if (!decl) {
    decl = defineKeyedSlot<InstalledFragment>(`system:fragments:active:${aspect}`);
    activeSlots.set(aspect, decl);
  }
  return decl;
}

/** An aspect of a resolved fragment whose activator threw: the aspect stays inactive. */
export interface FragmentFailure {
  readonly fragment: InstalledFragment;
  readonly aspect: Aspect;
  /** What the activator threw. */
  readonly error: unknown;
}

const failedSlots = new Map<Aspect, KeyedSlotDeclaration<FragmentFailure>>();

/**
 * Resolved fragments whose `aspect` failed to activate, with the error, by id
 * (`system:fragments:failed:<aspect>`). The fragments requiring one are not activated in
 * that aspect until `retry` activates it.
 */
export function failedFragmentsSlot(aspect: Aspect): KeyedSlotDeclaration<FragmentFailure> {
  let decl = failedSlots.get(aspect);
  if (!decl) {
    decl = defineKeyedSlot<FragmentFailure>(`system:fragments:failed:${aspect}`);
    failedSlots.set(aspect, decl);
  }
  return decl;
}

/**
 * A resolved fragment an activation of `aspect` was asked for but skipped, because
 * requirements with the aspect are not active (failed, or waiting themselves).
 */
export interface FragmentWaiting {
  readonly fragment: InstalledFragment;
  readonly aspect: Aspect;
  /**
   * The requirements with the aspect that are not active, direct or reached through
   * fragments lacking the aspect, in dependency order.
   */
  readonly blockers: readonly string[];
}

const waitingSlots = new Map<Aspect, KeyedSlotDeclaration<FragmentWaiting>>();

/**
 * Resolved fragments waiting, in `aspect`, for requirements that are not active, with
 * them, by id (`system:fragments:waiting:<aspect>`). `retry` activates them once their
 * requirements are; deactivating, disabling, removing and `stop` drop them.
 */
export function waitingFragmentsSlot(aspect: Aspect): KeyedSlotDeclaration<FragmentWaiting> {
  let decl = waitingSlots.get(aspect);
  if (!decl) {
    decl = defineKeyedSlot<FragmentWaiting>(`system:fragments:waiting:${aspect}`);
    waitingSlots.set(aspect, decl);
  }
  return decl;
}

/** An extension contributed at runtime, by code, through `extensionContributionsSlot`. */
export interface ExtensionContribution {
  /** The contributing fragment's id; the slot key must start with `<contributor>/`. */
  readonly contributor: string;
  /** The point's id: `<fragment-id>/<name>`, or a core point's short name. */
  readonly point: string;
  readonly data: unknown;
  readonly reference?: ExtensionReference;
}

const contributionSlots = new Map<Aspect, KeyedSlotDeclaration<ExtensionContribution>>();

/**
 * Extensions contributed at runtime to points of `aspect`, keyed `<contributor>/<name>`
 * (`system:extensions:contributed:<aspect>`). The owner reads them with the static ones,
 * while their contributor is resolved.
 */
export function extensionContributionsSlot(
  aspect: Aspect,
): KeyedSlotDeclaration<ExtensionContribution> {
  let decl = contributionSlots.get(aspect);
  if (!decl) {
    decl = defineKeyedSlot<ExtensionContribution>(`system:extensions:contributed:${aspect}`);
    contributionSlots.set(aspect, decl);
  }
  return decl;
}

/** Why an extension was refused. */
export type ExtensionRefusalCode =
  /** Its data does not match the point's schema. */
  | "invalid-data"
  /** The point is opened in another aspect than the extension's. */
  | "wrong-aspect"
  /** A runtime contribution that is malformed, or not keyed `<contributor>/<name>`. */
  | "invalid-contribution";

/** An extension the registry refused, kept while its contributor and the point are there. */
export interface ExtensionRefusal {
  /** The extension's id (`<contributor>#<n>`, or the runtime contribution's key). */
  readonly id: string;
  readonly contributor: string;
  readonly point: string;
  readonly code: ExtensionRefusalCode;
  readonly message: string;
}

const refusalSlots = new Map<Aspect, KeyedSlotDeclaration<ExtensionRefusal>>();

/** Extensions of `aspect` refused, by extension id (`system:extensions:refused:<aspect>`). */
export function extensionRefusalsSlot(aspect: Aspect): KeyedSlotDeclaration<ExtensionRefusal> {
  let decl = refusalSlots.get(aspect);
  if (!decl) {
    decl = defineKeyedSlot<ExtensionRefusal>(`system:extensions:refused:${aspect}`);
    refusalSlots.set(aspect, decl);
  }
  return decl;
}
