// The sole `@json-render/react` boundary for the workbench substrate.
// `<SpecRenderer>` wraps the json-render Renderer; `defineRegistry` and
// `schema` are re-exported so renderer fragments build their registries
// and catalogs without importing `@json-render/react` directly. The state
// hooks let renderer fragments author custom json-render component bindings
// (two-way prop binding, state-path binding) through the same boundary.
export type { Actions, Components, DefineRegistryResult } from "@json-render/react";
export {
  defineRegistry,
  schema,
  useBoundProp,
  useStateBinding,
  useStateStore,
  useStateValue,
} from "@json-render/react";
export { SpecRenderer, type SpecRendererProps } from "./spec-renderer.js";
