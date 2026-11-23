import { defineKeyedSlot, type KeyedSlotDeclaration } from "@statewalker/shared-slots";
import type { Aspect, InstalledFragment } from "./manifest.js";

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
