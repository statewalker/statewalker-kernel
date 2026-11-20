import { Catalog, type ComponentApi } from "@a2ui/web_core";
import { basicCatalog } from "@a2ui/web_core/catalogs/basic/v1";
import type { CommandDeclaration } from "@statewalker/shared-commands";
import { type ComponentType, createElement } from "react";
import { z } from "zod";

export type JsonSchema = Record<string, unknown>;
type EventsSchema = z.ZodObject<Record<string, z.ZodType>>;

export interface RenderProps<P, E extends EventsSchema> {
  props: P;
  emit: <K extends keyof z.infer<E> & string>(name: K, payload: z.infer<E>[K]) => void;
  /**
   * Two-way binding: write a value back to the data-model path the agent bound `prop` to.
   * Returns false when the prop is a literal (nothing to write to).
   */
  write?: <K extends keyof P & string>(prop: K, value: P[K]) => boolean;
}

/** Anything the catalog builder and router can consume: defined here or imported. */
export interface CatalogComponent {
  name: string;
  catalogEntry: JsonSchema;
  api: ComponentApi;
  events?: EventsSchema;
  commands?: Record<string, CommandDeclaration<any, any>>;
  render?: ComponentType<RenderProps<any, any>>;
}

export interface ComponentDef<P extends z.ZodObject, E extends EventsSchema>
  extends CatalogComponent {
  props: P;
  events: E;
  render: ComponentType<RenderProps<z.infer<P>, E>>;
}

export type ComponentProps<D> = D extends ComponentDef<infer P, any> ? z.infer<P> : never;

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
 * Decision (statewalker-root#153): no unions in props, except `.nullable()`. web_core's
 * runtime only knows unions of a literal and a binding; agents get them wrong otherwise.
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
    throw new Error(`defineComponent: union at ${path} is not allowed in catalog props`);
  }
  for (const key of ["anyOf", "oneOf"] as const) {
    const alts = s[key];
    if (Array.isArray(alts) && !(key === "anyOf" && isNullablePair(alts))) {
      throw new Error(`defineComponent: union at ${path} is not allowed in catalog props`);
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
 * Decision (statewalker-root#153): every prop is data-bindable. An unconstrained scalar
 * becomes the standard A2UI dynamic type (literal | {"@path"} | {"@call"}); anything else
 * becomes `anyOf: [<literal schema>, DataBinding]`, which web_core treats as DYNAMIC and
 * still validates the literal branch. Bound values are untyped: the renderer re-checks them.
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
  opts: { literalOnly?: string[]; bindable?: boolean } = {},
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
 * Catalog.fromJson derives the zod 3 validator from our JSON Schema.
 */
export function toComponentApi(name: string, catalogEntry: JsonSchema): ComponentApi {
  const fragment = Catalog.fromJson({
    catalogId: `fragment:${name}`,
    protocolVersion: "1.0",
    components: { [name]: catalogEntry },
  });
  const api = fragment.components.get(name);
  if (!api) throw new Error(`web_core did not accept the entry for ${name}`);
  return api;
}

/**
 * Bound props come from the untyped data model, so the resolved props are parsed with the
 * component's own Zod schema before render; a mismatch renders a placeholder.
 */
function guardProps<P extends z.ZodObject, E extends EventsSchema>(
  name: string,
  schema: P,
  Render: ComponentType<RenderProps<z.infer<P>, E>>,
): ComponentType<RenderProps<z.infer<P>, E>> {
  const Guarded = ({ props, emit, write }: RenderProps<z.infer<P>, E>) => {
    const parsed = schema.safeParse(props);
    if (!parsed.success) {
      return createElement(
        "span",
        { "data-a2ui-invalid": name, className: "a2ui-refused" },
        `[invalid props: ${name}]`,
      );
    }
    return createElement(Render, { props: parsed.data, emit, write });
  };
  Guarded.displayName = `Guarded(${name})`;
  return Guarded;
}

export function defineComponent<P extends z.ZodObject, E extends EventsSchema>(def: {
  name: string;
  description?: string;
  props: P;
  events: E;
  commands?: { [K in keyof z.infer<E>]?: CommandDeclaration<z.infer<E>[K], any> };
  render: ComponentType<RenderProps<z.infer<P>, E>>;
  /** Props an agent may only set as literals (e.g. ones that force a remount). */
  literalOnly?: (keyof z.infer<P> & string)[];
}): ComponentDef<P, E> {
  const eventNames = Object.keys(def.events.shape);
  const description = [def.description, eventNames.length ? `Emits: ${eventNames.join(", ")}.` : ""]
    .filter(Boolean)
    .join(" ");
  const jsonProps = z.toJSONSchema(def.props.strict()) as JsonSchema;
  assertNoUnions(jsonProps.properties);
  const catalogEntry = toCatalogEntry(def.name, jsonProps, description, {
    literalOnly: def.literalOnly,
  });
  return {
    ...def,
    render: guardProps(def.name, def.props, def.render),
    commands: def.commands as Record<string, CommandDeclaration<any, any>>,
    catalogEntry,
    api: toComponentApi(def.name, catalogEntry),
  };
}

/** A 1.0 catalog: named basic components from web_core plus ours. */
export function buildCatalog(opts: {
  catalogId: string;
  basic: string[];
  components: CatalogComponent[];
}): Catalog<ComponentApi> {
  const base = basicCatalog as unknown as Catalog<ComponentApi>;
  return base.derive({
    catalogId: opts.catalogId,
    components: [...opts.basic, ...opts.components.map((c) => c.api)],
  });
}
