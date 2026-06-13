import { Command, passthrough } from "@statewalker/shared-commands";
import type { FileInfo, FileStats } from "@statewalker/webrun-files";

// Primitive filesystem commands. The workspace owns the repository role,
// so these `files:*` commands are handled by `WorkspaceFilesManager`
// against the workspace's primary `FilesApi`. Keys keep the `files:`
// prefix so existing callers resolve unchanged.

/**
 * Result returned by `files:load-directory`. Mirrors a thin slice of
 * `FileInfo` plus optional MIME metadata.
 */
export interface DirectoryEntry extends FileInfo {
  mimeType?: string;
}

/**
 * Result returned by `files:load-file`. Carries the bytes plus derived
 * metadata so consumers don't re-stat after read.
 */
export interface LoadedFile {
  path: string;
  bytes: Uint8Array;
  stats?: FileStats;
  mimeType?: string;
}

export interface LoadDirectoryPayload {
  /** Workspace-relative path. Defaults to `/` when omitted. */
  path?: string;
  /** Recursive listing (descends into subdirectories). */
  recursive?: boolean;
}
export const LoadDirectoryCommand = Command.silent("files:load-directory")
  .input(passthrough<LoadDirectoryPayload>())
  .output(passthrough<readonly DirectoryEntry[]>())
  .build();

export interface LoadFilePayload {
  path: string;
}
export const LoadFileCommand = Command.silent("files:load-file")
  .input(passthrough<LoadFilePayload>())
  .output(passthrough<LoadedFile>())
  .build();

export interface WriteFilePayload {
  path: string;
  content: Uint8Array | string;
}
export const WriteFileCommand = Command.silent("files:write-file")
  .input(passthrough<WriteFilePayload>())
  .output(passthrough<void>())
  .build();

export interface MoveFilePayload {
  fromPath: string;
  toPath: string;
}
export const MoveFileCommand = Command.silent("files:move-file")
  .input(passthrough<MoveFilePayload>())
  .output(passthrough<void>())
  .build();

export interface DeleteFilePayload {
  path: string;
}
export const DeleteFileCommand = Command.silent("files:delete-file")
  .input(passthrough<DeleteFilePayload>())
  .output(passthrough<void>())
  .build();

export interface MkdirPayload {
  /** Workspace-relative path of the directory to create. */
  path: string;
}
export const MkdirCommand = Command.silent("files:mkdir")
  .input(passthrough<MkdirPayload>())
  .output(passthrough<void>())
  .build();

export interface RenamePayload {
  fromPath: string;
  toPath: string;
}
export const RenameCommand = Command.silent("files:rename")
  .input(passthrough<RenamePayload>())
  .output(passthrough<void>())
  .build();
