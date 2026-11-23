import type { Refusal } from "./errors.js";
import type { FragmentFiles, FragmentManifest } from "./manifest.js";
import { parseJsonc } from "./parse-manifest.js";

/**
 * One entry of `migrations` in a server half's `wrangler.jsonc`, as Cloudflare defines it:
 * a tag, applied once, and the Durable Object class changes it makes. A tag without class
 * changes is allowed: the fragment's own data migrations are keyed by the same tags.
 */
export interface ClassMigration {
  readonly tag: string;
  readonly new_classes?: readonly string[];
  readonly new_sqlite_classes?: readonly string[];
  readonly renamed_classes?: readonly { readonly from: string; readonly to: string }[];
  /** Deletes the classes' objects and their data: an upgrade needs confirmation. */
  readonly deleted_classes?: readonly string[];
  readonly transferred_classes?: readonly {
    readonly from: string;
    readonly from_script: string;
    readonly to: string;
  }[];
}

/**
 * The migrations of an archive, in order: the `migrations` of its `wrangler.jsonc` (none
 * without a server aspect). Refused when they are not a list of entries with distinct
 * string tags.
 */
export function readMigrations(
  files: FragmentFiles,
  manifest: FragmentManifest,
): { migrations: ClassMigration[]; refusal?: Refusal } {
  const text = manifest.aspects.server ? files["wrangler.jsonc"] : undefined;
  if (text === undefined) return { migrations: [] };
  const invalid = (message: string) => ({
    migrations: [],
    refusal: { id: manifest.id, code: "invalid-manifest" as const, message },
  });
  const { value } = parseJsonc(text);
  const raw = (value as { migrations?: unknown } | undefined)?.migrations;
  if (raw === undefined) return { migrations: [] };
  if (!Array.isArray(raw))
    return invalid(`"${manifest.id}": wrangler.jsonc migrations is not a list`);
  const tags = new Set<string>();
  for (const entry of raw) {
    const tag = (entry as { tag?: unknown } | null)?.tag;
    if (typeof tag !== "string" || tag === "") {
      return invalid(`"${manifest.id}": a wrangler.jsonc migration has no tag`);
    }
    if (tags.has(tag)) {
      return invalid(`"${manifest.id}": the wrangler.jsonc migration tag "${tag}" is repeated`);
    }
    tags.add(tag);
  }
  return { migrations: raw as ClassMigration[] };
}
