import { OpenCommand, VisualizeFileCommand } from "@statewalker/mime.core";
import { Commands } from "@statewalker/shared-commands";
import { newRegistry } from "@statewalker/shared-registry";
import { Slots } from "@statewalker/shared-slots";
import { FocusPanelCommand } from "@statewalker/shell.core";
import { getWorkspace } from "@statewalker/workspace.core";
import { fileExplorerPanelId } from "./catalog.js";
import { type ActiveFileExplorerPanel, activeFileExplorerPanelsSlot } from "./extension-points.js";

/**
 * Logic-fragment init for `@statewalker/file-explorer`.
 *
 * Registers the workspace-level glue:
 *
 *   - `files:open` command handler — probes the URI's kind on the
 *     workspace's `FilesApi` and routes by role:
 *       * directory → the panel named by the command's `target`
 *         (falls back to the panel flagged `folderNavigationHost`,
 *         then `origin`, then any active panel) and brings that
 *         panel's tab into focus.
 *       * file → `files:visualize` with `referencePanelId` set to
 *         the panel flagged `mainViewerHost`, so viewers always
 *         dock into a known group regardless of which panel was
 *         clicked.
 *
 * Per ADR 0002 (logic-only): no React imports.
 */
export default function initFileExplorer(ctx: Record<string, unknown>): () => Promise<void> {
  const workspace = getWorkspace(ctx);
  const commands = workspace.requireAdapter(Commands);
  const slots = workspace.requireAdapter(Slots);

  const [register, cleanup] = newRegistry();

  function findHostId(predicate: (p: ActiveFileExplorerPanel) => boolean): string | null {
    const snapshot = slots.getSnapshot(activeFileExplorerPanelsSlot);
    for (const [id, panel] of snapshot.entries()) {
      if (predicate(panel)) return id;
    }
    return null;
  }
  function panelsGet(id: string): ActiveFileExplorerPanel | null {
    return slots.get(activeFileExplorerPanelsSlot, id);
  }

  register(
    commands.listen(OpenCommand, (command) => {
      const { uri, origin, target } = command.payload;
      void (async () => {
        try {
          const files = workspace.files;
          const stats = await files.stats(uri);
          if (stats?.kind === "directory") {
            // Folder routing priority: explicit `target` (panels
            // self-target so folders open in-place) > the workspace's
            // `folderNavigationHost` (default destination for external
            // callers) > `origin` > first registered. Fall through if
            // no panel is mounted rather than throwing so the command
            // surface stays forgiving of teardown timing.
            const navHostId = findHostId((p) => p.isFolderNavigationHost);
            const targetId =
              (target && panelsGet(target) ? target : null) ??
              navHostId ??
              (origin && panelsGet(origin) ? origin : null) ??
              [...slots.getSnapshot(activeFileExplorerPanelsSlot).keys()][0] ??
              null;
            if (!targetId) {
              throw new Error(
                "files:open — no active file-explorer panel registered to host folder navigation",
              );
            }
            const panel = panelsGet(targetId);
            if (!panel) {
              throw new Error(`files:open — stale panel registration for "${targetId}"`);
            }
            panel.navigate(uri);
            // Bring the tab into focus so the navigation is visible
            // even when the user clicked from the *other* panel.
            commands
              .call(FocusPanelCommand, { panelId: fileExplorerPanelId(targetId) })
              .promise.catch(() => {
                // Focus is best-effort: a panel that hasn't been
                // dock-shown yet has nothing to focus. Swallow.
              });
            command.resolve();
            return;
          }
          // Files (and unknowns) go through the mime-renderer pipeline.
          // The viewer-host panel id is forwarded as `referencePanelId`
          // so the dock fragment opens the tab inside that panel's
          // group rather than wherever the active group happens to be.
          const viewerHostId = findHostId((p) => p.isMainViewerHost);
          await commands.call(VisualizeFileCommand, {
            uri,
            referencePanelId: viewerHostId ? fileExplorerPanelId(viewerHostId) : undefined,
          }).promise;
          command.resolve();
        } catch (err) {
          command.reject(err instanceof Error ? err : new Error(String(err)));
        }
      })();
      return true;
    }),
  );

  return cleanup;
}
