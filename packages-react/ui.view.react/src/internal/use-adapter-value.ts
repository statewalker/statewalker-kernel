import type { AdapterCtor, WorkspaceAdapter } from "@statewalker/workspace.core";
import { useSyncExternalStore } from "react";
import { useAdapter } from "./use-adapter.js";

/**
 * The minimal shape an adapter must expose to participate in
 * `useAdapterValue`. `BaseClass` from `@statewalker/shared-baseclass`
 * already provides this — it's the canonical source of `onUpdate`
 * subscriptions across the chat-mini fragments. Typed structurally
 * so we don't import `BaseClass` directly (some adapters might
 * implement the same shape without inheriting from it).
 */
export interface ObservableAdapter {
  onUpdate(cb: () => void): () => void;
}

/**
 * Read a reactive selection from a `BaseClass`-style workspace
 * adapter. Subscribes via `onUpdate`, re-renders on every notify,
 * and returns the latest selector output.
 *
 * Example:
 *   const isOpen = useAdapterValue(Settings, (s) => s.isOpen);
 *   const state  = useAdapterValue(AgentRuntimeAdapter, (a) => a.getState());
 *
 * Pass primitive selectors (string, boolean, number, frozen object
 * reference) so React's `Object.is` snapshot equality bails out
 * correctly. Selectors that materialise a fresh array/object every
 * call will trigger spurious re-renders.
 */
export function useAdapterValue<A extends WorkspaceAdapter & ObservableAdapter, T>(
  adapterCtor: AdapterCtor<A>,
  selector: (adapter: A) => T,
): T {
  const adapter = useAdapter(adapterCtor);
  return useSyncExternalStore(
    (cb) => adapter.onUpdate(cb),
    () => selector(adapter),
    () => selector(adapter),
  );
}
