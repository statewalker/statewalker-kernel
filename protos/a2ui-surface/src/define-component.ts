import { Catalog, type ComponentApi } from "@a2ui/web_core";
import { basicCatalog } from "@a2ui/web_core/catalogs/basic/v1";
import type { CommandDeclaration } from "@statewalker/shared-commands";
import type { ComponentType } from "react";
import { z } from "zod";

export type JsonSchema = Record<string, unknown>;
type EventsSchema = z.ZodObject<Record<string, z.ZodType>>;

export interface RenderProps<P, E extends EventsSchema> {
  props: P;
  emit: <K extends keyof z.infer<E> & string>(name: K, payload: z.infer<E>[K]) => void;
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

/** Zod 4 props → A2UI 1.0 component definition (JSON Schema, `component` discriminator). */
export function toCatalogEntry(name: string, props: JsonSchema, description?: string): JsonSchema {
  const { $schema: _drop, ...schema } = props as JsonSchema & { $schema?: string };
  const properties = Object.fromEntries(
    Object.entries((schema.properties ?? {}) as Record<string, unknown>).map(([k, v]) => [
      k,
      normalizeNullable(v),
    ]),
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

export function defineComponent<P extends z.ZodObject, E extends EventsSchema>(def: {
  name: string;
  description?: string;
  props: P;
  events: E;
  commands?: { [K in keyof z.infer<E>]?: CommandDeclaration<z.infer<E>[K], any> };
  render: ComponentType<RenderProps<z.infer<P>, E>>;
}): ComponentDef<P, E> {
  const eventNames = Object.keys(def.events.shape);
  const description = [def.description, eventNames.length ? `Emits: ${eventNames.join(", ")}.` : ""]
    .filter(Boolean)
    .join(" ");
  const catalogEntry = toCatalogEntry(def.name, z.toJSONSchema(def.props.strict()), description);
  return {
    ...def,
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
