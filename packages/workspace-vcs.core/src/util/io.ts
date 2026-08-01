// A local copy of the JSON file helpers. `@statewalker/workspace.core` has the same
// pair internally, but does not export them — `json-io.ts` is absent from its
// `builders/index.ts` barrel and its `exports` map has no wildcard, so neither the
// barrel nor a deep subpath reaches it. Adding that export would edit
// `workspace.core`, which this feature must not touch. `wiki.core` keeps its own
// copy at the same path for the same reason; this file mirrors it.
import { dirname, type FilesApi, tryReadText, writeText } from "@statewalker/webrun-files";

/** Read and parse a JSON file; `undefined` when it is absent or unparseable. */
export async function tryReadJson<T>(files: FilesApi, path: string): Promise<T | undefined> {
  const text = await tryReadText(files, path);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

let tmpSeq = 0;
/** A per-write temp path. Concurrent writers (e.g. multiple tabs or the CLI on the same
 * folder) must NOT share one `${path}.tmp` — they would clobber each other's temp file
 * and race the rename, corrupting the target. The final rename is last-writer-wins. */
function tempPath(path: string): string {
  tmpSeq = (tmpSeq + 1) % Number.MAX_SAFE_INTEGER;
  return `${path}.${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${tmpSeq}.tmp`;
}

async function writeAtomic(files: FilesApi, path: string, text: string): Promise<void> {
  const parent = dirname(path);
  if (parent && parent !== "/") await files.mkdir(parent);
  const tmp = tempPath(path);
  await writeText(files, tmp, text);
  const moved = await files.move(tmp, path);
  if (!moved) {
    await files.remove(tmp).catch(() => {});
    throw new Error(`writeAtomic: failed to rename ${tmp} to ${path}`);
  }
}

/** Serialize `value` and replace `path` with it atomically (write temp, then rename). */
export function writeJsonAtomic(files: FilesApi, path: string, value: unknown): Promise<void> {
  return writeAtomic(files, path, JSON.stringify(value, null, 2));
}
