import type { FragmentFiles } from "./manifest.js";

/**
 * The host's content-addressed store of installed fragment archives. An archive is stored
 * under its content hash (`archiveHash`) and never changes: storing other files under a
 * stored hash is refused, so a hash always names the same files. The kernel stores every
 * archive it installs or upgrades to, and reads one back to roll back. It deletes nothing:
 * the previous archive of an upgrade is kept.
 */
export interface ArchiveStore {
  /** Store `files` under `hash`; a no-op when they are stored already. */
  put(hash: string, files: FragmentFiles): Promise<void>;
  /** The files stored under `hash`, or `undefined`. */
  get(hash: string): Promise<FragmentFiles | undefined>;
}

const encoder = new TextEncoder();

/**
 * An archive's content hash: `sha256:` and the lowercase hex SHA-256 (Web Crypto) of its
 * files sorted by name, as the UTF-8 JSON text of `[[name, text], ...]`.
 */
export async function archiveHash(files: FragmentFiles): Promise<string> {
  const entries = Object.keys(files)
    .sort()
    .map((name) => [name, files[name]]);
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(entries)));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

/**
 * An `ArchiveStore` in memory, for tests and for hosts that keep archives elsewhere
 * themselves (a browser profile reloading them on start). It checks every hash it is given.
 */
export function createMemoryArchiveStore(): ArchiveStore {
  const stored = new Map<string, FragmentFiles>();
  return {
    async put(hash, files) {
      const actual = await archiveHash(files);
      if (actual !== hash) {
        throw new Error(`The archive's hash is ${actual}, not ${hash}`);
      }
      if (!stored.has(hash)) stored.set(hash, Object.freeze({ ...files }));
    },
    async get(hash) {
      return stored.get(hash);
    },
  };
}
