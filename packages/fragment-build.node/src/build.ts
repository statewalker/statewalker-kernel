import { existsSync } from "node:fs";
import { lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_DIRS,
  type FragmentArchive,
  type FragmentConfig,
  generateFragmentFiles,
  packArchive,
  serializeArchive,
} from "@statewalker/fragment-build.core";
import {
  ASPECTS,
  type Aspect,
  type FragmentManifest,
  isFragmentId,
  MANIFEST_FILE,
  parseJsonc,
} from "@statewalker/kernel.core";
import semver from "semver";
import { tsImport } from "tsx/esm/api";

export const CONFIG_FILE = "fragment.config.ts";

/** Root files that belong to the archive besides the aspect folders. */
const ROOT_FILES = /^(fragment(\.[a-z]+)?\.jsonc|wrangler\.jsonc|openapi\.json)$/;

/** Load `<dir>/fragment.config.ts` (its default export), or `undefined` when there is none. */
export async function loadFragmentConfig(dir: string): Promise<FragmentConfig | undefined> {
  const path = resolve(dir, CONFIG_FILE);
  if (!existsSync(path)) return undefined;
  // A query makes every load a fresh module, so a rebuild sees an edited config.
  const url = `${pathToFileURL(path).href}?t=${Date.now()}-${Math.random()}`;
  const module = (await tsImport(url, import.meta.url)) as { default?: FragmentConfig };
  const config = module.default;
  if (!config || typeof config !== "object") {
    throw new Error(`${path} has no default export (export default defineFragment({ ... }))`);
  }
  return config;
}

/**
 * Generate the files of `<dir>/fragment.config.ts` and write them beside it. Returns the
 * files written, or `undefined` when the folder has no config (hand-written JSON).
 */
export async function generateFragment(dir: string): Promise<Record<string, string> | undefined> {
  const config = await loadFragmentConfig(dir);
  if (!config) return undefined;
  const files = generateFragmentFiles(config);
  // The config is the contract: a root file it no longer generates (an older config's
  // wrangler.jsonc, openapi.json, fragment.server.jsonc) is removed, never packed.
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (ROOT_FILES.test(entry.name) && !(entry.name in files)) await rm(join(dir, entry.name));
  }
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  return files;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

async function walk(root: string, dir: string, out: Record<string, string>): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    // Dot entries (.wrangler state, .DS_Store) and installed dependencies stay out.
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    const name = relative(root, path).split(sep).join("/");
    if (entry.isDirectory()) await walk(root, path, out);
    else if (!entry.isFile()) {
      // A symbolic link (or socket, FIFO) is not packed silently: the archive would differ
      // from the folder that runs. Refused by name, like a binary file.
      throw new Error(
        `${name} is not a regular file (a symbolic link or special file): archives carry regular files only`,
      );
    } else {
      try {
        out[name] = decoder.decode(await readFile(path));
      } catch {
        throw new Error(
          `${name} is not UTF-8 text: archive format v1 carries text files only (binary assets need confirmation, see the README)`,
        );
      }
    }
  }
}

/**
 * The files of a fragment's built folder, by relative POSIX path: the root files
 * (`fragment.jsonc`, `fragment.<aspect>.jsonc`, `wrangler.jsonc`, `openapi.json`) and every
 * file under the folder of each aspect `fragment.jsonc` lists (its `dir`, else `server/`,
 * `client/`, `agent/`), skipping dot entries and `node_modules`. `rootFiles`, when given (the
 * files a config generated), are the root files instead of those on disk.
 */
export async function readFragmentFolder(
  dir: string,
  rootFiles?: Readonly<Record<string, string>>,
): Promise<Record<string, string>> {
  if (!existsSync(dir)) throw new Error(`${dir} does not exist`);
  const files: Record<string, string> = { ...rootFiles };
  if (!rootFiles) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isFile() && ROOT_FILES.test(entry.name)) {
        files[entry.name] = await readFile(join(dir, entry.name), "utf8");
      }
    }
  }
  const text = files[MANIFEST_FILE];
  if (text === undefined) throw new Error(`${dir} has no ${MANIFEST_FILE} and no ${CONFIG_FILE}`);
  const { value, error } = parseJsonc(text);
  if (error) throw new Error(`${MANIFEST_FILE} does not parse: ${error}`);
  const manifest = value as FragmentManifest;
  for (const aspect of ASPECTS) {
    const entry = manifest.aspects?.[aspect as Aspect];
    if (!entry) continue;
    const name = entry.dir ?? DEFAULT_DIRS[aspect];
    const folder = join(dir, name);
    const stats = await lstat(folder).catch(() => undefined);
    if (!stats) continue;
    if (!stats.isDirectory()) {
      throw new Error(`${name} is not a regular folder (a symbolic link or a file)`);
    }
    await walk(dir, folder, files);
  }
  return files;
}

export interface BuildOptions {
  /** Where the archive is written. Default `<dir>/dist`. */
  readonly outDir?: string;
  /** The archive's `$schema`. */
  readonly archiveSchema?: string;
}

export interface BuildResult {
  readonly id: string;
  readonly version: string;
  readonly hash: string;
  readonly archive: FragmentArchive;
  /** The archive file: `<outDir>/<id>-<version>.fragment.json`. */
  readonly path: string;
  /** Whether the files were generated from a `fragment.config.ts`. */
  readonly generated: boolean;
}

/**
 * Build a fragment folder: generate its files from `fragment.config.ts` (when there is one),
 * read the built folder, pack it, and write the archive document.
 */
export async function buildFragment(dir: string, options: BuildOptions = {}): Promise<BuildResult> {
  if (!existsSync(dir)) throw new Error(`${dir} does not exist`);
  const rootFiles = await generateFragment(dir);
  const generated = rootFiles !== undefined;
  const archive = await packArchive(await readFragmentFolder(dir, rootFiles));
  const { value } = parseJsonc(archive.files[MANIFEST_FILE] ?? "");
  const { id, version } = value as FragmentManifest;
  // Both name the archive file: refuse anything that is not an id or a semver version.
  if (typeof id !== "string" || !isFragmentId(id)) {
    throw new Error(`${MANIFEST_FILE}: "${String(id)}" is not a valid fragment id`);
  }
  if (typeof version !== "string" || semver.valid(version) !== version) {
    throw new Error(`${MANIFEST_FILE}: "${String(version)}" is not a valid fragment version`);
  }
  const outDir = resolve(options.outDir ?? join(dir, "dist"));
  const path = resolve(outDir, `${id}-${version}.fragment.json`);
  if (dirname(path) !== outDir) throw new Error(`The archive ${path} would leave ${outDir}`);
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path,
    serializeArchive(archive, options.archiveSchema ? { schema: options.archiveSchema } : {}),
  );
  return { id, version, hash: archive.hash, archive, path, generated };
}
