import { getWorkspace } from "@statewalker/workspace.core";
import { WorkspaceBridgeManager } from "../internal/workspace-bridge.manager.js";
import { WorkspaceShellAdapter } from "../internal/workspace-shell-adapter.js";

/**
 * Logic-fragment init for workspace-bridge. Registers:
 *   - the `WorkspaceShellAdapter` (single source of truth for the
 *     FS-Access shell state machine, per ADR 0004),
 *   - the canonical `workspace:change` handler from
 *     `@statewalker/workspace` (close → setFileSystem → open),
 *   - `workspace:reconnect` and `workspace:disconnect` handlers
 *     wired to the adapter, the IndexedDB handle store, and the
 *     `requestPermission` flow.
 *
 * Silent-restore starts from the manager constructor (not gated on
 * `onLoad`) so the adapter transitions out of `loading` as soon as
 * IndexedDB and the permission API resolve.
 *
 * Adapter registration: we do NOT call `workspace.setAdapter(...)`
 * here. `WorkspaceShellAdapter` is a class, so the workspace's
 * `getAdapter` fallback path auto-instantiates it on first
 * `requireAdapter` (per `Workspace.getAdapter`'s "concrete tokens
 * self-host" semantics). Calling `setAdapter` would clear and
 * re-create the instance on every re-entrant `init` cycle, which
 * would orphan any React subscribers that captured the previous
 * instance.
 */
export default function initWorkspaceBridge(ctx: Record<string, unknown>): () => Promise<void> {
  const workspace = getWorkspace(ctx);
  workspace.requireAdapter(WorkspaceShellAdapter);
  const manager = new WorkspaceBridgeManager({ workspace });
  return () => manager.close();
}
