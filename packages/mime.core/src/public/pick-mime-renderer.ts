import type { Slots } from "@statewalker/shared-slots";
import { pickRenderer } from "../internal/files.manager.js";
import { mimeRenderersSlot } from "./extension-points.js";
import type { MimeRenderer } from "./types.js";

/**
 * Resolves the best `MimeRenderer` contribution from `files:mime-renderers`
 * for the given MIME type. Selection policy (per the
 * `file-management-split` spec):
 *
 * 1. Filter the slot snapshot to entries whose `mimeTypePattern`
 *    matches `mime` exactly OR matches by glob (`*` wildcards).
 * 2. If no entries match, return `undefined`.
 * 3. Sort matching entries by `order ?? 100` ascending.
 * 4. Return the first entry.
 *
 * `files:visualize` calls this selector. Other callers SHALL NOT
 * re-implement the policy.
 */
export function pickMimeRenderer(slots: Slots, mime: string): MimeRenderer | undefined {
  const snapshot = slots.getSnapshot(mimeRenderersSlot);
  return pickRenderer(snapshot, mime);
}
