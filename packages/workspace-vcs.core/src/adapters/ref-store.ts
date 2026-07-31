import { type History, isSymbolicRef } from "@statewalker/vcs-core";
import type { RefStore } from "@statewalker/vcs-transport";

/**
 * The transport's `RefStore` over a `History`'s refs — the server side of every
 * smart-HTTP exchange, and the object the push/fetch handlers read and update.
 *
 * Written once, here, because **`vcs/packages/**` exports no `RefStore` factory
 * at all**. Six hand-rolled copies exist, all under `apps/**` (not installed by
 * this umbrella) and with three different signatures, so "reuse the existing one"
 * was never an option.
 *
 * The two interfaces are close but not the same, and the gaps are where the bugs
 * live:
 *
 * - **`listAll()` must drop symbolic refs.** `Refs.list()` yields `HEAD` — the
 *   create path writes `.git/HEAD` as `ref: refs/heads/main` — and a `SymbolicRef`
 *   has a `target`, not an `objectId`. Passing it through would advertise
 *   `undefined HEAD` on the wire.
 * - **`get()` resolves, it does not read.** `RefStore.get` returns an object id, so
 *   it maps to `Refs.resolve` (which follows symrefs), not to `Refs.get` (which
 *   returns the raw, possibly symbolic, value).
 * - **`listAll()` must drop remote-tracking refs.** This store is the SERVER side
 *   of an exchange, and `refs/remotes/origin/*` is a private record of what some
 *   other machine had. Real git servers advertise no such thing; advertising them
 *   leaks the local machine's remote topology to every peer and offers refs no
 *   client asked about.
 *
 * **`update()` is blind, by construction.** `RefStore.update(name, oid)` carries no
 * expected old value, so a server built on this cannot reject a non-fast-forward
 * push — it has nothing to compare against. Force and non-force pushes are therefore
 * indistinguishable receiver-side here. That is a property of the interface, not an
 * oversight, and it is why the in-process server is a test fixture rather than
 * something to deploy.
 */
/** Remote-tracking refs: local bookkeeping, never advertised to a peer. */
const TRACKING_PREFIX = "refs/remotes/";

export function refStoreOf(history: History): RefStore {
  const refs = history.refs;
  return {
    async get(name: string): Promise<string | undefined> {
      return (await refs.resolve(name))?.objectId;
    },

    async update(name: string, oid: string): Promise<void> {
      await refs.set(name, oid);
    },

    async listAll(): Promise<Iterable<[string, string]>> {
      const entries: Array<[string, string]> = [];
      for await (const ref of refs.list()) {
        if (isSymbolicRef(ref) || !ref.objectId) continue;
        if (ref.name.startsWith(TRACKING_PREFIX)) continue;
        entries.push([ref.name, ref.objectId]);
      }
      return entries;
    },

    async getSymrefTarget(name: string): Promise<string | undefined> {
      const ref = await refs.get(name);
      return ref && isSymbolicRef(ref) ? ref.target : undefined;
    },

    async isRefTip(oid: string): Promise<boolean> {
      for await (const ref of refs.list()) {
        if (!isSymbolicRef(ref) && ref.objectId === oid) return true;
      }
      return false;
    },
  };
}
