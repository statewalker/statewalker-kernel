import type { ComponentType } from "react";
import type { CatalogComponent, RenderProps } from "../src/index.js";
import { basicRenderers } from "./basic-renderers.js";
import type { Registry } from "./renderer.js";

const guarded = new WeakMap<CatalogComponent, ComponentType<RenderProps<any, any>>>();

/**
 * A component's view behind its own Zod props schema: bound props come from the untyped data
 * model, so the resolved props are parsed before render; a mismatch renders a placeholder.
 */
export function viewOf(
  component: CatalogComponent,
): ComponentType<RenderProps<any, any>> | undefined {
  const { render: Render, props: schema, name } = component;
  if (!Render) return undefined;
  const known = guarded.get(component);
  if (known) return known;
  const View = Render as unknown as ComponentType<RenderProps<any, any>>;
  const Guarded = ({ props, emit, write }: RenderProps<any, any>) => {
    if (!schema) return <View props={props} emit={emit} write={write} />;
    const parsed = schema.safeParse(props);
    if (!parsed.success) {
      return (
        <span data-a2ui-invalid={name} className="a2ui-refused">
          [invalid props: {name}]
        </span>
      );
    }
    return <View props={parsed.data} emit={emit} write={write} />;
  };
  Guarded.displayName = `Guarded(${name})`;
  guarded.set(component, Guarded);
  return Guarded;
}

/** The basic renderers plus each component's guarded view. */
export function createRegistry(components: readonly CatalogComponent[]): Registry {
  const registry: Record<string, ComponentType<RenderProps<any, any>>> = { ...basicRenderers };
  for (const component of components) {
    const view = viewOf(component);
    if (view && !Object.hasOwn(basicRenderers, component.name)) registry[component.name] = view;
  }
  return Object.freeze(registry);
}
