// defineComponent: a catalog component defined once (statewalker-root ADR
// 2026-11-20-a2ui-client-spec-layer, decision 2). Its Zod props generate the A2UI 1.0 catalog
// entry, every prop bindable unless `literalOnly`; its Zod events map to command ids. The view
// is the fragment's own (React, usually lazy): this module never imports React, so the light
// definition stays loadable without it.
import { Catalog, type ComponentApi } from "@a2ui/web_core";
import { z } from "zod";

export type JsonSchema = Record<string, unknown>;
export type EventsSchema = z.ZodObject<Record<string, z.ZodType>>;

/** What a component's view receives. */
export interface RenderProps<P, E extends EventsSchema = EventsSchema> {
  /** The resolved props, bound values included, checked against the component's Zod schema. */
  props: P;
  /** Emit one of the component's declared events; the router maps it to its command. */
  emit: <K extends keyof z.infer<E> & string>(name: K, payload: z.infer<E>[K]) => void;
  /**
   * Two-way binding: write a value back to the data-model path the surface bound `prop` to.
   * Returns false when the prop is a literal (nothing to write to).
   */
  write?: <K extends keyof P & string>(prop: K, value: P[K]) => boolean;
}

/**
 * A component's view: any React function component or `lazy()` component taking
 * `RenderProps`. Typed structurally so this module stays React-free.
 */
export type ComponentView<P, E extends EventsSchema = EventsSchema> = (
  props: RenderProps<P, E>,
) => unknown;

/** Anything the catalog builder and the router consume: defined here or imported. */
export interface CatalogComponent {
  readonly name: string;
  readonly catalogEntry: JsonSchema;
  readonly api: ComponentApi;
  /** The Zod schema bound values are re-checked against at render. */
  readonly props?: z.ZodObject;
  readonly events?: EventsSchema;
  /** Event name → the id of the command it runs (`<fragment-id>/<command-id>`). */
  readonly commands?: Readonly<Record<string, string>>;
  readonly render?: ComponentView<any, any>;
}

/** A component defined with `defineComponent`. */
export interface ComponentDefinition<
  P extends z.ZodObject = z.ZodObject,
  E extends EventsSchema = EventsSchema,
> extends CatalogComponent {
  readonly description?: string;
  readonly props: P;
  readonly events: E;
  readonly literalOnly?: readonly string[];
  readonly render: ComponentView<z.infer<P>, E>;
}

export type ComponentProps<D> = D extends ComponentDefinition<infer P, any> ? z.infer<P> : never;

/** Why `defineComponent` refused a definition. */
export class ComponentDefinitionError extends Error {
  override readonly name = "ComponentDefinitionError";
}

/**
 * web_core's JSON Schema → zod 3 derivation accepts any value for `anyOf`, which is how
 * zod 4 emits `.nullable()`. Rewrite `anyOf: [X, {type: "null"}]` as a type array.
 */
function normalizeNullable(prop: unknown): unknown {
  const p = prop as { anyOf?: Record<string, unknown>[] };
  const alts = p?.anyOf;
  if (!Array.isArray(alts) || alts.length !== 2) return prop;
  const inner = alts.find((a) => a.type !== "null");
  if (!inner || !alts.some((a) => a.type === "null") || typeof inner.type !== "string") return prop;
  const { anyOf: _drop, ...rest } = p;
  return {
    ...rest,
    ...inner,
    type: [inner.type, "null"],
    ...(Array.isArray(inner.enum) ? { enum: [...inner.enum, null] } : {}),
  };
}

const isNullablePair = (alts: unknown[]) =>
  alts.length === 2 && alts.some((a) => (a as JsonSchema)?.type === "null");

/**
 * No unions in props, except `.nullable()`: web_core's runtime only knows unions of a literal
 * and a binding, and checks no other `anyOf`.
 */
export function assertNoUnions(schema: unknown, path = "props"): void {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema)) {
    schema.forEach((s, i) => {
      assertNoUnions(s, `${path}[${i}]`);
    });
    return;
  }
  const s = schema as JsonSchema;
  // zod 4 writes a union of scalars as a type array.
  if (Array.isArray(s.type) && s.type.filter((t) => t !== "null").length > 1) {
    throw new ComponentDefinitionError(
      `defineComponent: union at ${path} is not allowed in catalog props`,
    );
  }
  for (const key of ["anyOf", "oneOf"] as const) {
    const alts = s[key];
    if (Array.isArray(alts) && !(key === "anyOf" && isNullablePair(alts))) {
      throw new ComponentDefinitionError(
        `defineComponent: union at ${path} is not allowed in catalog props`,
      );
    }
  }
  for (const [k, v] of Object.entries(s)) {
    if (v && typeof v === "object") assertNoUnions(v, k === "properties" ? path : `${path}.${k}`);
  }
}

const DYNAMIC_REF: Record<string, string> = {
  string: "DynamicString",
  number: "DynamicNumber",
  integer: "DynamicNumber",
  boolean: "DynamicBoolean",
};
const COMMON = "common_types.json#/$defs/";

/**
 * Every prop is data-bindable. An unconstrained scalar becomes the standard A2UI dynamic type
 * (literal | {"@path"} | {"@call"}); anything else becomes `anyOf: [<literal schema>,
 * DataBinding]`, which web_core treats as dynamic and still validates the literal branch.
 * Bound values are untyped: the renderer re-checks them.
 */
export function toBindable(prop: JsonSchema): JsonSchema {
  const { type, description, ...rest } = prop;
  const ref = typeof type === "string" ? DYNAMIC_REF[type] : undefined;
  if (ref && Object.keys(rest).length === 0) {
    return { $ref: `${COMMON}${ref}`, ...(description ? { description } : {}) };
  }
  return {
    anyOf: [prop, { $ref: `${COMMON}DataBinding` }],
    ...(description ? { description } : {}),
  };
}

/** Zod 4 props → A2UI 1.0 component definition (JSON Schema, `component` discriminator). */
export function toCatalogEntry(
  name: string,
  props: JsonSchema,
  description?: string,
  opts: { literalOnly?: readonly string[]; bindable?: boolean } = {},
): JsonSchema {
  const { $schema: _drop, ...schema } = props as JsonSchema & { $schema?: string };
  const properties = Object.fromEntries(
    Object.entries((schema.properties ?? {}) as Record<string, JsonSchema>).map(([k, v]) => {
      const p = normalizeNullable(v) as JsonSchema;
      const literal = opts.bindable === false || opts.literalOnly?.includes(k);
      return [k, literal ? p : toBindable(p)];
    }),
  );
  return {
    ...schema,
    ...(description ? { description } : {}),
    type: "object",
    properties: { component: { const: name }, ...properties },
    required: ["component", ...((schema.required as string[]) ?? [])],
  };
}

/**
 * web_core entries hold a zod 3 schema; ours are zod 4. Crossing via JSON Schema:
 * `Catalog.fromJson` derives the zod 3 validator from our JSON Schema.
 */
export function toComponentApi(name: string, catalogEntry: JsonSchema): ComponentApi {
  const fragment = Catalog.fromJson({
    catalogId: `fragment:${name}`,
    protocolVersion: "1.0",
    components: { [name]: catalogEntry },
  });
  const api = fragment.components.get(name);
  if (!api) throw new ComponentDefinitionError(`web_core did not accept the entry for ${name}`);
  return api;
}

/** A component name: an identifier starting with an upper-case letter. */
export const COMPONENT_NAME_PATTERN = "^[A-Z][A-Za-z0-9]*$";

export function defineComponent<P extends z.ZodObject, E extends EventsSchema>(def: {
  name: string;
  description?: string;
  props: P;
  events: E;
  /** Event name → the id of the command it runs (`<fragment-id>/<command-id>`). */
  commands?: { [K in keyof z.infer<E>]?: string };
  /** The view: a React component taking `RenderProps`, usually `lazy(() => import(...))`. */
  render: ComponentView<z.infer<P>, E>;
  /** Props an agent may only set as literals (ones whose change means a new component). */
  literalOnly?: (keyof z.infer<P> & string)[];
}): ComponentDefinition<P, E> {
  if (!new RegExp(COMPONENT_NAME_PATTERN).test(def.name)) {
    throw new ComponentDefinitionError(
      `defineComponent: the name ${JSON.stringify(def.name)} does not match ${COMPONENT_NAME_PATTERN}`,
    );
  }
  const eventNames = Object.keys(def.events.shape);
  for (const event of Object.keys(def.commands ?? {})) {
    if (!eventNames.includes(event)) {
      throw new ComponentDefinitionError(
        `defineComponent: ${def.name} maps the undeclared event ${event} to a command`,
      );
    }
  }
  const description = [def.description, eventNames.length ? `Emits: ${eventNames.join(", ")}.` : ""]
    .filter(Boolean)
    .join(" ");
  const jsonProps = z.toJSONSchema(def.props.strict()) as JsonSchema;
  assertNoUnions(jsonProps.properties);
  const catalogEntry = toCatalogEntry(def.name, jsonProps, description, {
    literalOnly: def.literalOnly,
  });
  return Object.freeze({
    name: def.name,
    description: def.description,
    props: def.props,
    events: def.events,
    commands: Object.freeze({ ...(def.commands ?? {}) }) as Readonly<Record<string, string>>,
    literalOnly: def.literalOnly,
    render: def.render,
    catalogEntry,
    api: toComponentApi(def.name, catalogEntry),
  });
}

/** Whether `value` looks like a `defineComponent` result (a resolved catalog reference). */
export function isComponentDefinition(value: unknown): value is ComponentDefinition {
  const v = value as Partial<ComponentDefinition> | undefined;
  return (
    !!v &&
    typeof v === "object" &&
    typeof v.name === "string" &&
    !!v.catalogEntry &&
    !!v.api &&
    !!v.props &&
    typeof (v.props as { safeParse?: unknown }).safeParse === "function" &&
    !!v.events &&
    (typeof v.render === "function" || (typeof v.render === "object" && v.render !== null))
  );
}
