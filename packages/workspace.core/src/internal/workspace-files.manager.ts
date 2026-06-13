import { Commands } from "@statewalker/shared-commands";
import { readFile, writeText } from "@statewalker/webrun-files";
import {
  DeleteFileCommand,
  type DirectoryEntry,
  LoadDirectoryCommand,
  type LoadedFile,
  LoadFileCommand,
  MkdirCommand,
  MoveFileCommand,
  RenameCommand,
  WriteFileCommand,
} from "../public/files-commands.js";
import type { Workspace } from "../public/types/workspace.js";
import { getMimeType } from "./get-mime-type.js";

/**
 * Registers the primitive `files:*` command handlers against the
 * workspace's primary `FilesApi`. The workspace absorbs the repository
 * role, so these handlers live here rather than in a separate fragment.
 * Handlers reject with a clear error while the workspace is closed.
 */
export class WorkspaceFilesManager {
  private readonly workspace: Workspace;
  private readonly _disposers: Array<() => void> = [];

  constructor({ workspace }: { workspace: Workspace }) {
    this.workspace = workspace;
    const commands = workspace.requireAdapter(Commands);

    this._disposers.push(
      commands.listen(LoadDirectoryCommand, (cmd) => {
        const path = cmd.payload?.path ?? "/";
        const recursive = cmd.payload?.recursive ?? false;
        void this._loadDirectory(path, recursive)
          .then((entries) => cmd.resolve(entries))
          .catch((error) => cmd.reject(error));
        return true;
      }),
      commands.listen(LoadFileCommand, (cmd) => {
        void this._loadFile(cmd.payload.path)
          .then((file) => cmd.resolve(file))
          .catch((error) => cmd.reject(error));
        return true;
      }),
      commands.listen(WriteFileCommand, (cmd) => {
        void this._writeFile(cmd.payload.path, cmd.payload.content)
          .then(() => cmd.resolve())
          .catch((error) => cmd.reject(error));
        return true;
      }),
      commands.listen(MoveFileCommand, (cmd) => {
        void this._moveFile(cmd.payload.fromPath, cmd.payload.toPath)
          .then(() => cmd.resolve())
          .catch((error) => cmd.reject(error));
        return true;
      }),
      commands.listen(DeleteFileCommand, (cmd) => {
        void this._deleteFile(cmd.payload.path)
          .then(() => cmd.resolve())
          .catch((error) => cmd.reject(error));
        return true;
      }),
      commands.listen(MkdirCommand, (cmd) => {
        void this._mkdir(cmd.payload.path)
          .then(() => cmd.resolve())
          .catch((error) => cmd.reject(error));
        return true;
      }),
      commands.listen(RenameCommand, (cmd) => {
        void this._moveFile(cmd.payload.fromPath, cmd.payload.toPath)
          .then(() => cmd.resolve())
          .catch((error) => cmd.reject(error));
        return true;
      }),
    );
  }

  dispose(): void {
    for (const dispose of this._disposers) dispose();
    this._disposers.length = 0;
  }

  private async _loadDirectory(
    path: string,
    recursive: boolean,
  ): Promise<readonly DirectoryEntry[]> {
    this._requireOpen();
    const entries: DirectoryEntry[] = [];
    for await (const info of this.workspace.files.list(path, { recursive })) {
      entries.push({ ...info, mimeType: getMimeType(info.path) });
    }
    return entries;
  }

  private async _loadFile(path: string): Promise<LoadedFile> {
    this._requireOpen();
    const bytes = await readFile(this.workspace.files, path);
    const stats = await this.workspace.files.stats(path);
    return { path, bytes, stats, mimeType: getMimeType(path) };
  }

  private async _writeFile(path: string, content: Uint8Array | string): Promise<void> {
    this._requireOpen();
    if (typeof content === "string") {
      await writeText(this.workspace.files, path, content);
    } else {
      await this.workspace.files.write(path, [content]);
    }
  }

  private async _moveFile(from: string, to: string): Promise<void> {
    this._requireOpen();
    const ok = await this.workspace.files.move(from, to);
    if (!ok) throw new Error(`move failed: source missing: ${from}`);
  }

  private async _deleteFile(path: string): Promise<void> {
    this._requireOpen();
    await this.workspace.files.remove(path);
  }

  private async _mkdir(path: string): Promise<void> {
    this._requireOpen();
    await this.workspace.files.mkdir(path);
  }

  private _requireOpen(): void {
    if (!this.workspace.isOpened) {
      throw new Error("files:* commands require an open workspace — call runChangeWorkspace first");
    }
  }
}
