import { newRegistry } from "@statewalker/shared-registry";

/**
 * Logic-fragment init for `inline-content`. The descriptor slot
 * `inline-content:components` is a pure data declaration exported from
 * the public surface; init is a no-op. The renderer-side slot
 * `inline-content:renderers` and its React-typed slot value live in
 * `@statewalker/inline-content-react`.
 */
export default function initInlineContent(_ctx: Record<string, unknown>): () => Promise<void> {
  const [, cleanup] = newRegistry();
  return cleanup;
}
