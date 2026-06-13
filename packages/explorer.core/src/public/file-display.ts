import type { FileInfo } from "@statewalker/webrun-files";

/**
 * Display-ready file entry — computed from `FileInfo` by the model.
 * Icon/color resolution is a model concern, not a view concern.
 */
export interface FileDisplayEntry extends FileInfo {
  /** Lucide icon name: "folder", "file-text", "file-code", etc. */
  icon: string;
  /** Tailwind color class: "text-primary", "text-yellow-400", etc. */
  iconColor: string;
  /** Pre-formatted size: "4.2 KB", "" for directories. */
  displaySize: string;
  /** Pre-formatted date: "Mar 15, 2026". */
  displayDate: string;
}

const IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "svg", "webp", "ico", "bmp"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "flac", "m3u", "ogg", "aac"]);
const VIDEO_EXTS = new Set(["mp4", "mkv", "avi", "mov", "webm"]);
const CODE_EXTS = new Set([
  "ts",
  "js",
  "tsx",
  "jsx",
  "py",
  "html",
  "css",
  "json",
  "yaml",
  "yml",
  "md",
  "sh",
  "bash",
  "rs",
  "go",
  "java",
  "c",
  "cpp",
  "h",
  "rb",
  "toml",
]);
const ARCHIVE_EXTS = new Set(["zip", "rar", "7z", "tar", "gz", "bz2", "xz"]);
const DOC_EXTS = new Set(["txt", "pdf", "doc", "docx", "xlsx", "pptx", "rtf", "csv"]);

export function resolveFileIcon(entry: FileInfo): string {
  if (entry.kind === "directory") return "folder";
  const ext = getExtension(entry.name);
  if (!ext) return "file";
  if (IMAGE_EXTS.has(ext)) return "file-image";
  if (AUDIO_EXTS.has(ext)) return "file-audio";
  if (VIDEO_EXTS.has(ext)) return "file-video";
  if (CODE_EXTS.has(ext)) return "file-code";
  if (ARCHIVE_EXTS.has(ext)) return "file-archive";
  if (DOC_EXTS.has(ext)) return "file-text";
  return "file";
}

export function resolveFileIconColor(entry: FileInfo): string {
  if (entry.kind === "directory") return "text-primary";
  const ext = getExtension(entry.name);
  if (!ext) return "text-muted-foreground";
  if (IMAGE_EXTS.has(ext)) return "text-green-400";
  if (AUDIO_EXTS.has(ext)) return "text-purple-400";
  if (VIDEO_EXTS.has(ext)) return "text-red-400";
  if (CODE_EXTS.has(ext)) return "text-yellow-400";
  if (ARCHIVE_EXTS.has(ext)) return "text-orange-400";
  if (DOC_EXTS.has(ext)) return "text-blue-400";
  return "text-muted-foreground";
}

export function formatFileSize(bytes: number | undefined): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatFileDate(ts: number | undefined): string {
  if (!ts) return "";
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function toDisplayEntry(entry: FileInfo): FileDisplayEntry {
  return {
    ...entry,
    icon: resolveFileIcon(entry),
    iconColor: resolveFileIconColor(entry),
    displaySize: entry.kind === "file" ? formatFileSize(entry.size) : "",
    displayDate: formatFileDate(entry.lastModified),
  };
}

function getExtension(name: string): string | undefined {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return undefined;
  return name.slice(dot + 1).toLowerCase();
}
