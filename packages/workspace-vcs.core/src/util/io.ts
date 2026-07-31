import type { FilesApi } from "@statewalker/webrun-files";

export async function tryReadJson<T>(_files: FilesApi, _path: string): Promise<T | undefined> {
  throw new Error("not implemented");
}

export async function writeJsonAtomic(
  _files: FilesApi,
  _path: string,
  _value: unknown,
): Promise<void> {
  throw new Error("not implemented");
}
