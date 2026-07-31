import type { History } from "@statewalker/vcs-core";
import type { RefStore } from "@statewalker/vcs-transport";

/**
 * The transport's `RefStore` over a `History`'s refs — the server side of every
 * smart-HTTP exchange, and the object the push/fetch handlers read and update.
 *
 * Written once, here, because **`vcs/packages/**` exports no `RefStore` factory
 * at all**. Six hand-rolled copies exist, all under `apps/**` (not installed by
 * this umbrella) and with three different signatures, so "reuse the existing one"
 * was never an option.
 */
export function refStoreOf(_history: History): RefStore {
  throw new Error("not implemented");
}
