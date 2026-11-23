import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fragmentManifestSchemaV1 } from "../src/index.js";

describe("the shipped manifest schema", () => {
  it("is the schema the kernel validates fragment.jsonc with", () => {
    const file = resolve(import.meta.dirname, "../schemas/fragment.v1.schema.json");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(fragmentManifestSchemaV1);
  });

  it("is JSON Schema 2020-12 with no namespace key", () => {
    expect(fragmentManifestSchemaV1.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(Object.keys(fragmentManifestSchemaV1.properties)).not.toContain("namespace");
  });
});
