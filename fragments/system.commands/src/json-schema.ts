import { type OutputUnit, Validator } from "@cfworker/json-schema";
import type { CommandDeclaration } from "@statewalker/shared-commands";
import type { JsonSchema } from "./catalogue.js";

type StandardSchema = CommandDeclaration<unknown, unknown>["inputSchema"];

/** cfworker's output units as one line each, leaving out the units that only wrap others. */
export function describeErrors(errors: readonly OutputUnit[]): string[] {
  return errors
    .filter((e) => e.keyword !== "properties" && e.keyword !== "$ref")
    .map((e) => `${e.instanceLocation || "#"}: ${e.error}`);
}

/** A JSON Schema (2020-12) validator. */
export function jsonValidator(schema: JsonSchema): (value: unknown) => string[] {
  const validator = new Validator(schema as Record<string, unknown>, "2020-12", false);
  return (value) => {
    const result = validator.validate(value);
    return result.valid ? [] : describeErrors(result.errors);
  };
}

/** A JSON Schema as a Standard Schema, so the shared-commands bus validates with it. */
export function jsonStandardSchema(schema: JsonSchema): StandardSchema {
  const validate = jsonValidator(schema);
  return {
    "~standard": {
      version: 1,
      vendor: "json-schema",
      validate(value: unknown) {
        const errors = validate(value);
        return errors.length === 0 ? { value } : { issues: errors.map((message) => ({ message })) };
      },
    },
  };
}
