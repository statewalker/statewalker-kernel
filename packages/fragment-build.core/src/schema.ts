import { z } from "zod";
import type { JsonSchema, SchemaInput } from "./config.js";

function isZod(schema: SchemaInput): schema is z.ZodType {
  return typeof schema === "object" && schema !== null && "_zod" in schema;
}

/**
 * A config's schema as JSON Schema 2020-12: a Zod schema through `z.toJSONSchema` (for the
 * input side of transforms with `io: "input"`), JSON Schema as it is. The top-level `$schema`
 * is dropped: the documents embedding it already say they are 2020-12.
 */
export function toJsonSchema(schema: SchemaInput, io: "input" | "output" = "output"): JsonSchema {
  if (!isZod(schema)) return schema;
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { target: "draft-2020-12", io }) as Record<
    string,
    unknown
  >;
  return rest;
}
