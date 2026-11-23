import { Validator } from "@cfworker/json-schema";
import { type ParseError, parse, printParseErrorCode } from "jsonc-parser";
import semver from "semver";
import type { Refusal } from "./errors.js";
import { ASPECTS, type FragmentFiles, type FragmentManifest } from "./manifest.js";
import { fragmentManifestSchemaV1 } from "./schema.js";
import { describeErrors } from "./validation.js";

export const MANIFEST_FILE = "fragment.jsonc";

const validators = new Map<number, Validator>([
  [1, new Validator(fragmentManifestSchemaV1 as never, "2020-12", false)],
]);

/** Parse a JSONC text; `undefined` plus a message when it does not parse. */
export function parseJsonc(text: string): { value?: unknown; error?: string } {
  const errors: ParseError[] = [];
  const value = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  const first = errors[0];
  if (first) return { error: `${printParseErrorCode(first.error)} at offset ${first.offset}` };
  return { value };
}

/**
 * Read and validate an archive's `fragment.jsonc`: JSONC, then the JSON Schema its
 * `$schema` names, then the semver fields the schema cannot check.
 */
export function readManifest(
  files: FragmentFiles,
):
  | { manifest: FragmentManifest; refusal?: undefined }
  | { manifest?: undefined; refusal: Refusal } {
  const invalid = (message: string, id?: string) => ({
    refusal: { id, code: "invalid-manifest" as const, message },
  });
  const text = files[MANIFEST_FILE];
  if (text === undefined) return invalid(`The archive has no ${MANIFEST_FILE}`);
  const { value, error } = parseJsonc(text);
  if (error) return invalid(`${MANIFEST_FILE} does not parse: ${error}`);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid(`${MANIFEST_FILE} is not an object`);
  }
  const raw = value as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : undefined;
  const schema = typeof raw.$schema === "string" ? raw.$schema : undefined;
  if (!schema) return invalid(`${MANIFEST_FILE} has no $schema`, id);
  const version = /(?:^|\/)fragment\.v(\d+)\.schema\.json$/.exec(schema)?.[1];
  const validator = version === undefined ? undefined : validators.get(Number(version));
  if (!validator) return invalid(`Unknown manifest schema "${schema}"`, id);

  const result = validator.validate(raw);
  if (!result.valid) {
    return invalid(
      `${MANIFEST_FILE} does not match its schema: ${describeErrors(result.errors)}`,
      id,
    );
  }
  const manifest = raw as unknown as FragmentManifest;
  if (!semver.valid(manifest.version)) {
    return invalid(`version "${manifest.version}" is not a semver version`, id);
  }
  if (!semver.validRange(manifest.engines.platform)) {
    return invalid(`engines.platform "${manifest.engines.platform}" is not a semver range`, id);
  }
  for (const [dep, range] of Object.entries(manifest.requires ?? {})) {
    if (!semver.validRange(range)) {
      return invalid(`requires["${dep}"] "${range}" is not a semver range`, id);
    }
  }
  // A point's id carries no aspect, so a name is opened in one aspect only.
  const opened = new Map<string, string>();
  for (const aspect of ASPECTS) {
    for (const name of Object.keys(manifest.aspects[aspect]?.extensionPoints ?? {})) {
      const other = opened.get(name);
      if (other) {
        return invalid(
          `the extension point "${name}" is opened in both the ${other} and the ${aspect} aspect`,
          id,
        );
      }
      opened.set(name, aspect);
    }
  }
  return { manifest };
}
