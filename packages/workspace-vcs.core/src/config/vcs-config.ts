import { joinPath as concatPath } from "@statewalker/webrun-files";
import { DEFAULT_SYSTEM_FOLDER, type Project, ProjectAdapter } from "@statewalker/workspace.core";
import { tryReadJson, writeJsonAtomic } from "../util/io.js";

/** The VCS nature's marker / config file, under the project system folder. */
export const VCS_NATURE_FILE = "nature.vcs.json";

/**
 * The per-project VCS configuration, as persisted in `.project/nature.vcs.json`.
 *
 * This declaration **is the closed schema** {@link VcsConfiguration.write} enforces:
 * every key that may be persisted appears here, and nothing else may be written under
 * any name. Adding a field means adding it to {@link validateVcsConfig} in the same
 * commit — the two are meant to be read together.
 */
export interface VcsConfigData {
  /** Marker + schema version. The presence of the file is what makes a project
   * VCS-natured; the version is what lets a later shape be migrated. */
  version: 1;
  /** Default remote used by push/fetch when the caller names none. */
  defaultRemote?: string;
  /** Display identity for commits. NOT a credential: credentials live in the
   * workspace `Secrets` store and never appear in this file. */
  author?: { name: string; email: string };
}

/** Top-level allowlist — the keys of {@link VcsConfigData}. */
const CONFIG_KEYS = ["version", "defaultRemote", "author"] as const;
/** Allowlist for the `author` sub-object. */
const AUTHOR_KEYS = ["name", "email"] as const;

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${VCS_NATURE_FILE}: ${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  data: Record<string, unknown>,
  allowed: readonly string[],
  what: string,
): void {
  for (const key of Object.keys(data)) {
    if (!allowed.includes(key)) {
      throw new Error(
        `${VCS_NATURE_FILE}: unknown key "${key}" in ${what} — this file is a closed schema ` +
          `(allowed: ${allowed.join(", ")}). Nothing outside it is persisted; credentials belong ` +
          `in the workspace Secrets store.`,
      );
    }
  }
}

function requireString(data: Record<string, unknown>, key: string, what: string): void {
  if (typeof data[key] !== "string") {
    throw new Error(`${VCS_NATURE_FILE}: "${what}" must be a string`);
  }
}

/**
 * Validate a configuration against the closed schema, throwing on the first
 * violation. An **allowlist**, deliberately — not a check for "credential-shaped"
 * keys. A name heuristic both over- and under-fires (it flags `author`, and waves
 * through `{"o": "<a token>"}`); an allowlist is binary, has no false positives, and
 * refuses a smuggled secret whatever it is called.
 */
export function validateVcsConfig(cfg: VcsConfigData): void {
  const data = asRecord(cfg, "configuration");
  rejectUnknownKeys(data, CONFIG_KEYS, "configuration");

  if (data.version !== 1) {
    throw new Error(`${VCS_NATURE_FILE}: "version" must be 1, got ${JSON.stringify(data.version)}`);
  }
  if (data.defaultRemote !== undefined) requireString(data, "defaultRemote", "defaultRemote");
  if (data.author !== undefined) {
    const author = asRecord(data.author, `"author"`);
    rejectUnknownKeys(author, AUTHOR_KEYS, `"author"`);
    for (const key of AUTHOR_KEYS) requireString(author, key, `author.${key}`);
  }
}

/**
 * The VCS nature's per-project configuration, exposed as a project adapter and
 * persisted at `<project>/.project/nature.vcs.json`. The file doubles as the
 * **nature marker**: a project has the VCS nature exactly when it exists.
 *
 * Following `WikiLlmConfiguration` (and `AiConfig` before it), the file is read once
 * by {@link load} into an in-memory cache and the synchronous getter reads that
 * cache — so callers MUST `load()` before touching {@link data}, which throws
 * otherwise rather than silently reporting an empty configuration.
 */
export class VcsConfiguration extends ProjectAdapter {
  private cfg?: VcsConfigData;

  /** `<project>/.project/nature.vcs.json`, on the **workspace** filesystem. Note this
   * is not the project-rooted view the repository itself uses (`repoFilesOf`): the
   * config is workspace metadata, and lives beside every other nature's marker. */
  private configPath(): string {
    return concatPath(this.path.replace(/^\/+|\/+$/g, ""), DEFAULT_SYSTEM_FOLDER, VCS_NATURE_FILE);
  }

  /** Whether the VCS nature is materialized (marker present on disk or already loaded). */
  async exists(): Promise<boolean> {
    if (this.cfg) return true;
    return (await tryReadJson<VcsConfigData>(this.filesApi, this.configPath())) != null;
  }

  /** Read the per-project config into memory (idempotent). Throws when absent. */
  async load(): Promise<this> {
    if (this.cfg) return this;
    const data = await tryReadJson<VcsConfigData>(this.filesApi, this.configPath());
    if (!data) {
      throw new Error(`vcs nature not initialized: ${this.configPath()} is absent`);
    }
    this.cfg = data;
    return this;
  }

  /**
   * Validate against the closed schema, then write the marker and cache it
   * (materializes the VCS nature). A rejected configuration writes nothing and
   * caches nothing — validation runs before the file is touched.
   *
   * Validation guards the **write** path, which is the one this code owns. `load()`
   * does not re-validate: a file written by a later version must still open, and a
   * user's hand edits are theirs. What matters for the credentials invariant is that
   * nothing this process persists can carry a key the schema never declared.
   */
  async write(cfg: VcsConfigData): Promise<void> {
    validateVcsConfig(cfg);
    await writeJsonAtomic(this.filesApi, this.configPath(), cfg);
    this.cfg = cfg;
  }

  /** The loaded config, or throw if {@link load} has not run. */
  get data(): VcsConfigData {
    if (!this.cfg) throw new Error("VcsConfiguration not loaded; call load() first");
    return this.cfg;
  }

  /** Default remote for push/fetch when the caller names none. */
  get defaultRemote(): string | undefined {
    return this.data.defaultRemote;
  }

  /** Commit identity, when the project declares one. */
  get author(): { name: string; email: string } | undefined {
    return this.data.author;
  }
}

/** Resolve the VCS configuration from a project (mirrors `wikiConfigOf`). */
export function vcsConfigOf(project: Project): VcsConfiguration {
  return project.requireAdapter(VcsConfiguration);
}
