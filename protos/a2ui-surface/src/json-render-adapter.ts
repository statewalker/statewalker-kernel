import { z } from "zod";
import {
  type CatalogComponent,
  type JsonSchema,
  toCatalogEntry,
  toComponentApi,
} from "./define-component.js";

interface JsonRenderCatalogLike {
  data: { components: Record<string, { props: z.ZodType; description?: string }> };
}

/** One-time migration: json-render catalog components → A2UI 1.0 catalog entries. */
export function importJsonRenderCatalog(catalog: JsonRenderCatalogLike): CatalogComponent[] {
  return Object.entries(catalog.data.components).map(([name, def]) => {
    const catalogEntry = toCatalogEntry(
      name,
      z.toJSONSchema(def.props) as JsonSchema,
      def.description,
    );
    return { name, catalogEntry, api: toComponentApi(name, catalogEntry) };
  });
}

/** Reverse direction, for the round-trip check: A2UI entry → json-render (zod 4) props. */
export function jsonRenderPropsFromEntry(entry: JsonSchema): z.ZodType {
  const { properties, required, ...rest } = entry as {
    properties: Record<string, unknown>;
    required: string[];
  };
  const { component: _c, ...props } = properties;
  return z.fromJSONSchema({
    ...rest,
    properties: props,
    required: required.filter((r) => r !== "component"),
  } as Parameters<typeof z.fromJSONSchema>[0]);
}
