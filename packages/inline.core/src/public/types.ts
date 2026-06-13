/**
 * Declarative description of an inline content block. Carried in
 * structured form (e.g. inside an assistant message) and rendered
 * by `<InlineContent>` which resolves `componentId` against
 * `InlineContentRegistry`.
 *
 * `props` is intentionally `unknown` — each component casts at the
 * rendering boundary, the same way json-render specs are held
 * opaquely by `SpecStore`. Keeps the registry decoupled from any
 * specific component's prop shape.
 */
export interface InlineContentSpec {
  componentId: string;
  props: unknown;
}

/**
 * Slot value contributed to `inline-content:components`. Each
 * built-in or plug-in inline component contributes a descriptor so
 * tooling, plug-in managers, and (eventually) the agent can
 * enumerate available components without rendering them.
 */
export interface InlineComponentDescriptor {
  id: string;
  /** Short human-readable label shown in tooling. */
  label?: string;
  /** Optional longer description (one-line). */
  description?: string;
}
