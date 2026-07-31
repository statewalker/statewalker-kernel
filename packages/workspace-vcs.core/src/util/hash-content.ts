/** A stream of bytes — the shape `@statewalker/vcs-workspace` hashes. */
export type ByteStream = AsyncIterable<Uint8Array>;

/** Content identity function: stream in, stable id out. */
export type HashContent = (input: ByteStream) => Promise<string>;

/** Hex SHA-256 over the concatenated chunks of `input`. */
export const hashContentSha256: HashContent = async () => {
  throw new Error("not implemented");
};
