import type { FragmentInit } from "./app-manifest.js";

/**
 * Shared fragment-activation loop used by both browser and server bootstrap.
 *
 * For each entry in `ordered`, call `loadModule(entry)` to obtain the module,
 * invoke its `default` export (if it is a function) with `ctx`, and collect
 * any returned teardown. Per-module errors are routed to `onError` (defaults
 * to console.error) and the loop continues — one failing module cannot abort
 * the rest of the bootstrap.
 *
 * The returned cleanup invokes collected teardowns in reverse registration
 * order and awaits each one.
 */
export async function activateModules<T>(
  ordered: T[],
  loadModule: (entry: T) => Promise<Record<string, unknown> | undefined>,
  ctx: Record<string, unknown>,
  onError: (entry: T, error: unknown) => void = defaultOnError,
): Promise<() => Promise<void>> {
  const teardowns: Array<() => void | Promise<void>> = [];

  for (const entry of ordered) {
    let mod: Record<string, unknown> | undefined;
    try {
      mod = await loadModule(entry);
    } catch (error) {
      onError(entry, error);
      continue;
    }
    if (!mod) continue;

    const init = mod.default;
    if (typeof init !== "function") continue;

    try {
      const teardown = await (init as FragmentInit)(ctx);
      if (typeof teardown === "function") {
        teardowns.push(teardown as () => void | Promise<void>);
      }
    } catch (error) {
      onError(entry, error);
    }
  }

  return async () => {
    for (let i = teardowns.length - 1; i >= 0; i--) {
      try {
        await teardowns[i]?.();
      } catch (error) {
        onError(ordered[i] as T, error);
      }
    }
  };
}

function defaultOnError(entry: unknown, error: unknown): void {
  console.error(`[backbone] Module activation failed for ${String(entry)}:`, error);
}
