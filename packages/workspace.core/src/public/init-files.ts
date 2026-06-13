import { WorkspaceFilesManager } from "../internal/workspace-files.manager.js";
import { getWorkspace } from "./types/index.js";

/**
 * Logic-fragment init that wires the primitive `files:*` filesystem
 * command handlers (`WorkspaceFilesManager`) against the workspace's
 * primary `FilesApi`.
 *
 * Host-neutral: the handlers only touch `workspace.files`, which works
 * against any `FilesApi` (Mem / Node / browser). It is therefore booted
 * as its own fragment root rather than folded into a host-specific
 * bridge (e.g. the browser `workspace-bridge`), so non-browser hosts
 * get the same command surface.
 */
export default function initWorkspaceFiles(ctx: Record<string, unknown>): () => void {
  const workspace = getWorkspace(ctx);
  const manager = new WorkspaceFilesManager({ workspace });
  return () => manager.dispose();
}
