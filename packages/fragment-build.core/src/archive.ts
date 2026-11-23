import { archiveHash, type FragmentFiles } from "@statewalker/kernel.core";

/**
 * A packed fragment: its built folder's files by relative path, as text, and their content
 * hash (kernel.core's `archiveHash`, the key of the host's archive store). `files` is the kernel's install input as it is (`kernel.install([archive.files])`):
 * the kernel reads the root files and keeps the rest for the host.
 */
export interface FragmentArchive {
  readonly hash: string;
  readonly files: FragmentFiles;
}

export const DEFAULT_ARCHIVE_SCHEMA =
  "./node_modules/@statewalker/fragment-build.core/schemas/fragment-archive.v1.schema.json";

const ARCHIVE_SCHEMA_PATTERN = /(?:^|\/)fragment-archive\.v(\d+)\.schema\.json$/;

function sortedPaths(files: FragmentFiles): string[] {
  return Object.keys(files).sort();
}

/** Whether `path` is a relative POSIX path that stays inside the fragment's folder. */
export function isArchivePath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\")) return false;
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function checkPaths(files: FragmentFiles): void {
  for (const path of Object.keys(files)) {
    if (!isArchivePath(path)) throw new Error(`Invalid archive path "${path}"`);
    if (typeof files[path] !== "string") throw new Error(`Archive file "${path}" is not text`);
  }
}

/** Pack a fragment's files (its built folder, by relative path) into an archive. */
export async function packArchive(files: FragmentFiles): Promise<FragmentArchive> {
  checkPaths(files);
  const sorted = Object.fromEntries(sortedPaths(files).map((path) => [path, files[path] ?? ""]));
  return { hash: await archiveHash(sorted), files: sorted };
}

/**
 * An archive as one JSON document (`fragment-archive.v1.schema.json`): `$schema`, `hash` and
 * the files sorted by path, so the same files always give the same bytes.
 */
export function serializeArchive(
  archive: FragmentArchive,
  options: { schema?: string } = {},
): string {
  const files = Object.fromEntries(
    sortedPaths(archive.files).map((path) => [path, archive.files[path]]),
  );
  return `${JSON.stringify({ $schema: options.schema ?? DEFAULT_ARCHIVE_SCHEMA, hash: archive.hash, files })}\n`;
}

/**
 * Read an archive document back into the kernel's install input, refusing an unknown
 * `$schema` version, a path leaving the folder, and files that do not match the hash.
 */
export async function readArchive(text: string): Promise<FragmentFiles> {
  const raw = JSON.parse(text) as { $schema?: unknown; hash?: unknown; files?: unknown };
  const version =
    typeof raw?.$schema === "string" ? ARCHIVE_SCHEMA_PATTERN.exec(raw.$schema)?.[1] : undefined;
  if (version !== "1") throw new Error(`Unknown archive schema "${String(raw?.$schema)}"`);
  if (typeof raw.hash !== "string" || !raw.files || typeof raw.files !== "object") {
    throw new Error("An archive needs a hash and files");
  }
  const files = raw.files as FragmentFiles;
  checkPaths(files);
  const actual = await archiveHash(files);
  if (actual !== raw.hash) {
    throw new Error(`The archive's files hash to ${actual}, not to its hash ${raw.hash}`);
  }
  return files;
}
