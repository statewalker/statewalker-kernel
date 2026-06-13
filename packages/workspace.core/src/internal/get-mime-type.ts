import { extensionToMimeType } from "./mime-types.js";

export function getMimeType(url: string): string {
  url = url || "";
  const originalUrl = url;
  url = url.split("?").shift()!; // Remove queries (if any)
  url = url.split("/").pop()!; // Keep only the last segment of the path
  const extension = url.split(".").pop()!; // Get extension
  let mimeType = extensionToMimeType[extension];
  if (!mimeType) {
    mimeType =
      originalUrl.match(/api\.observablehq\.com/) || originalUrl.match(/\.ojs$/)
        ? "application/javascript-observable"
        : "application/binary";
  }
  return mimeType;
}
