import type { KeyedSlotDeclaration, SlotDeclaration, Slots } from "@statewalker/shared-slots";
import { useMemo, useSyncExternalStore } from "react";

/**
 * React hook: subscribe to a plain slot's contributions on the given
 * `Slots` bus.
 *
 * Pass the typed declaration returned by `defineSlot(key)`. The hook
 * reads `decl.key` directly. Returns a referentially-stable readonly
 * array — the same reference is returned across renders unless the
 * slot mutated, so `useSyncExternalStore` does not loop.
 */
export function useSlot<T>(slots: Slots, decl: SlotDeclaration<T>): readonly T[] {
  return useSyncExternalStore(
    (notify) => slots.observe(decl, () => notify()),
    () => slots.getSnapshot(decl),
  );
}

/**
 * Reactive view of a keyed slot. Returned by `useKeyedSlot`.
 *
 * `entries` is a reference-stable `ReadonlyMap<string, T>` (suitable
 * for memoised iteration). `get(id)` is O(1).
 */
export interface KeyedSlotView<T> {
  get(id: string): T | null;
  readonly entries: ReadonlyMap<string, T>;
}

/**
 * React hook: subscribe to a keyed slot.
 *
 * Returns a `KeyedSlotView<T>`. Re-renders whenever the underlying
 * slot's contributions for the declaration change.
 */
export function useKeyedSlot<T>(slots: Slots, decl: KeyedSlotDeclaration<T>): KeyedSlotView<T> {
  const entries = useSyncExternalStore(
    (notify) => slots.observe(decl, () => notify()),
    () => slots.getSnapshot(decl),
  );
  return useMemo<KeyedSlotView<T>>(
    () => ({
      entries,
      get(id: string): T | null {
        return slots.get(decl, id);
      },
    }),
    [slots, decl, entries],
  );
}
