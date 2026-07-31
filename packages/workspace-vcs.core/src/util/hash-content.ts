/** A stream of bytes — the shape `@statewalker/vcs-workspace` hashes. */
export type ByteStream = AsyncIterable<Uint8Array>;

/**
 * Content identity function: stream in, stable id out.
 *
 * Structurally identical to `WorkflowOptions.hashContent`, declared here rather
 * than imported so `src/util/` stays free of a dependency on the orchestrator.
 */
export type HashContent = (input: ByteStream) => Promise<string>;

/**
 * Lowercase hex SHA-256 over the concatenated chunks of `input`.
 *
 * **The one `hashContent` this feature ships**, because no shipped package
 * exports one — `vcs-workspace`'s own tests bring an unpublished test helper.
 * `manifest()` and `publish()`'s checkpoint manifest are only comparable when
 * both are computed with the SAME function, so this is a single exported
 * instance rather than a factory.
 *
 * Buffers the whole stream: `crypto.subtle.digest` has no streaming form, and a
 * content id must cover every byte. Fine for workbench project files; not for
 * gigabyte blobs.
 */
export const hashContentSha256: HashContent = async (input) => {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of input) {
    chunks.push(chunk);
    length += chunk.length;
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};
