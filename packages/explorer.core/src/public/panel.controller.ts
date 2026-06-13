import type { FileInfo, FilesApi } from "@statewalker/webrun-files";
import { FilesListModel } from "./files-list.model.js";

/**
 * Loads `path` from `files`, populates `model.entries`, restores
 * cursor to `focusName` (used when navigating up). Errors land on
 * `model.error`. Public so callers can re-use it from tests or from
 * the explorer.app two-pane preset.
 */
export async function loadDirectory(
  files: FilesApi,
  model: FilesListModel,
  path: string,
  focusName?: string,
): Promise<void> {
  const stopLoading = model.startLoading({ path });
  try {
    const entries: FileInfo[] = [];

    if (path !== "/") {
      entries.push({
        name: "..",
        path: parentPath(path),
        kind: "directory",
      });
    }

    for await (const entry of files.list(path)) {
      entries.push(entry);
    }
    stopLoading({ entries });

    if (focusName) {
      const visible = model.getVisibleEntries();
      const idx = visible.findIndex((e) => e.name === focusName);
      if (idx >= 0) {
        model.cursorIndex = idx;
        model.notify();
      }
    }
  } catch (err) {
    stopLoading({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function parentPath(path: string): string {
  const parts = path.replace(/\/$/, "").split("/").filter(Boolean);
  parts.pop();
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

function basename(path: string): string {
  const parts = path.replace(/\/$/, "").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export interface PanelController {
  readonly model: FilesListModel;
  readonly files: FilesApi;
  navigate(path: string): void;
  setFiles(newFiles: FilesApi, label: string): void;
  refresh(): void;
}

/**
 * Constructs one panel orchestrator over a `FilesApi`. The controller
 * owns the panel's `FilesListModel` and the I/O glue that loads
 * directories into it. It does NOT subscribe to model events —
 * activation routing is the caller's responsibility (typically via
 * the `files:open` command), so the controller stays free of
 * lifecycle/StrictMode coupling.
 *
 * The first `navigate("/")` (or to `initialPath`, when provided) is
 * dispatched synchronously so the panel shows entries on first paint.
 */
export function createPanelController(params: {
  files: FilesApi;
  title: string;
  initialPath?: string;
}): PanelController {
  let currentFiles = params.files;

  const model = new FilesListModel();
  model.setTitle(params.title);

  function navigate(path: string): void {
    const currentPath = model.path;
    const isGoingUp = currentPath.startsWith(path) && currentPath !== path;
    const focusName = isGoingUp ? basename(currentPath) : undefined;
    void loadDirectory(currentFiles, model, path, focusName);
  }

  function setFiles(newFiles: FilesApi, label: string): void {
    currentFiles = newFiles;
    model.setTitle(label);
    navigate("/");
  }

  function refresh(): void {
    navigate(model.path);
  }

  navigate(params.initialPath ?? "/");

  return {
    model,
    get files() {
      return currentFiles;
    },
    navigate,
    setFiles,
    refresh,
  };
}
