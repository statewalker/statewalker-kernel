import { JSONUIProvider, Renderer } from "@json-render/react";
import type { ReactElement } from "react";

export interface SpecRendererProps {
  /** json-render spec, held opaquely (`unknown`) by the SpecStore. */
  spec: unknown;
  /** json-render registry, held opaquely by the catalogs slot. */
  registry: unknown;
  /**
   * Optional external json-render `StateStore` (held opaquely). Pass one when
   * the spec is state-driven and an outside projection (e.g. a domain → state
   * bridge) needs to seed and update the store the `<Renderer>` reads. When
   * omitted, `<JSONUIProvider>` manages its own internal store — the right
   * default for self-contained single-component specs (dock panels).
   */
  store?: unknown;
  /**
   * Optional action-handler map (`{ [actionName]: (params) => void | Promise }`,
   * held opaquely). Required for specs whose elements dispatch `on.<event>`
   * actions: json-render's `ActionProvider` resolves handlers from here, NOT
   * from the registry's action *schemas*. Without it, dispatched actions log
   * "No handler registered" and do nothing.
   */
  handlers?: unknown;
}

/**
 * Renders a json-render `spec` against a `registry`. The single place
 * the workbench substrate crosses into `@json-render/react`:
 * `<JSONUIProvider>` sets up the visibility / validation / state
 * contexts that `<Renderer>`'s internals read from.
 *
 * Spec and registry are typed `unknown` because the SpecStore and the
 * `json:catalogs` slot deliberately hold them opaquely; the concrete
 * json-render types live only at this boundary.
 */
export function SpecRenderer({ spec, registry, store, handlers }: SpecRendererProps): ReactElement {
  // biome-ignore lint/suspicious/noExplicitAny: json-render's Spec/Registry types live behind `unknown` in our stores
  const Renderer$ = Renderer as any;
  // biome-ignore lint/suspicious/noExplicitAny: ditto for the registry shape
  const registry$ = registry as any;
  // biome-ignore lint/suspicious/noExplicitAny: the StateStore is held opaquely at this boundary
  const store$ = store as any;
  // biome-ignore lint/suspicious/noExplicitAny: the handler map is held opaquely at this boundary
  const handlers$ = handlers as any;
  return (
    <JSONUIProvider registry={registry$} store={store$} handlers={handlers$}>
      <Renderer$ spec={spec} registry={registry$} />
    </JSONUIProvider>
  );
}
