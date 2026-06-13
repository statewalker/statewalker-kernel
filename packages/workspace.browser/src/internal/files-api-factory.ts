import type { FilesApi } from "@statewalker/webrun-files";
import { BrowserFilesApi } from "@statewalker/webrun-files-browser";

interface FileSystemHandleWithPermissions {
  queryPermission(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission(descriptor?: { mode?: "read" | "readwrite" }): Promise<PermissionState>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: "read" | "readwrite";
    }) => Promise<FileSystemDirectoryHandle>;
  }
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

/**
 * Pick a workspace folder via the File System Access API. Throws if the
 * browser does not support it or if the user cancels.
 */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle> {
  if (!window.showDirectoryPicker) {
    throw new Error("Your browser does not support the File System Access API.");
  }
  return await window.showDirectoryPicker({ mode: "readwrite" });
}

/** Query (does not prompt) the readwrite permission state for a handle. */
export async function queryHandlePermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  const h = handle as unknown as FileSystemHandleWithPermissions;
  return await h.queryPermission({ mode: "readwrite" });
}

/** Request (may prompt) the readwrite permission. Must be called from a user gesture. */
export async function requestHandlePermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  const h = handle as unknown as FileSystemHandleWithPermissions;
  return await h.requestPermission({ mode: "readwrite" });
}

/** Wrap a directory handle as a `FilesApi`. */
export function createBrowserFilesApi(handle: FileSystemDirectoryHandle): FilesApi {
  return new BrowserFilesApi({ rootHandle: handle });
}
