import { Validator } from "@cfworker/json-schema";
import { type ParseError, parse, printParseErrorCode } from "jsonc-parser";
import semver from "semver";
import type { Refusal } from "./errors.js";
import {
  ASPECTS,
  type Aspect,
  type AspectManifest,
  aspectFileOf,
  type FragmentFiles,
  type FragmentManifest,
} from "./manifest.js";
import { fragmentAspectSchemaV1, fragmentManifestSchemaV1 } from "./schema.js";
import { describeErrors } from "./validation.js";

export const MANIFEST_FILE = "fragment.jsonc";

const validators = new Map<number, Validator>([
  [1, new Validator(fragmentManifestSchemaV1 as never, "2020-12", false)],
]);

const aspectValidators = new Map<number, Validator>([
  [1, new Validator(fragmentAspectSchemaV1 as never, "2020-12", false)],
]);

/** Aspects whose file must be present when the aspect is; the server's is `wrangler.jsonc`. */
const REQUIRED_ASPECT_FILES: readonly Aspect[] = ["client", "agent"];

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
  return { manifest };
}

/**
 * Read and validate the aspect files of a fragment whose manifest is `manifest`:
 * `fragment.client.jsonc` and `fragment.agent.jsonc` for each of those aspects present
 * (required), `fragment.server.jsonc` for the server aspect (optional), and none for an
 * aspect absent. Each is JSONC validated against the schema its `$schema` names.
 */
export function readAspectFiles(
  files: FragmentFiles,
  manifest: FragmentManifest,
): { aspects: Partial<Record<Aspect, AspectManifest>>; refusals: Refusal[] } {
  const refusals: Refusal[] = [];
  const invalid = (message: string) =>
    refusals.push({ id: manifest.id, code: "invalid-manifest", message });
  const aspects: Partial<Record<Aspect, AspectManifest>> = {};
  for (const aspect of ASPECTS) {
    const name = aspectFileOf(aspect);
    const text = files[name];
    const present = manifest.aspects[aspect] !== undefined;
    if (text === undefined) {
      if (present && REQUIRED_ASPECT_FILES.includes(aspect)) {
        invalid(`"${manifest.id}" has a ${aspect} aspect but no ${name}`);
      }
      continue;
    }
    if (!present) {
      invalid(`"${manifest.id}" has a ${name} but no ${aspect} aspect in ${MANIFEST_FILE}`);
      continue;
    }
    const { value, error } = parseJsonc(text);
    if (error) {
      invalid(`${name} does not parse: ${error}`);
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      invalid(`${name} is not an object`);
      continue;
    }
    const raw = value as Record<string, unknown>;
    const schema = typeof raw.$schema === "string" ? raw.$schema : undefined;
    if (!schema) {
      invalid(`${name} has no $schema`);
      continue;
    }
    const version = /(?:^|\/)fragment-aspect\.v(\d+)\.schema\.json$/.exec(schema)?.[1];
    const validator = version === undefined ? undefined : aspectValidators.get(Number(version));
    if (!validator) {
      invalid(`${name}: unknown aspect schema "${schema}"`);
      continue;
    }
    const result = validator.validate(raw);
    if (!result.valid) {
      invalid(`${name} does not match its schema: ${describeErrors(result.errors)}`);
      continue;
    }
    aspects[aspect] = raw as unknown as AspectManifest;
  }
  // A point's id carries no aspect, so a name is opened in one aspect only.
  const opened = new Map<string, Aspect>();
  for (const aspect of ASPECTS) {
    for (const point of Object.keys(aspects[aspect]?.extensionPoints ?? {})) {
      const other = opened.get(point);
      if (other) {
        invalid(
          `"${manifest.id}" opens the extension point "${point}" in both ${aspectFileOf(other)} and ${aspectFileOf(aspect)}`,
        );
      }
      opened.set(point, aspect);
    }
  }
  return { aspects, refusals };
}
