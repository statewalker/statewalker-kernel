import type { FileInfo } from "@statewalker/webrun-files";
import { type FileDisplayEntry, toDisplayEntry } from "./file-display.js";
import { ViewModel } from "./view-model.js";

/**
 * Reactive state for one file-explorer panel's listing. Owns:
 *  - cwd (`path`)
 *  - entries returned from `files.list(path)`
 *  - cursor/selection
 *  - sort field, filter pattern, hidden-file toggle
 *
 * Pure data — no side effects. The panel orchestrator does I/O and
 * pushes results in via `startLoading`. Activation (folder
 * navigation, file open) is dispatched by the view through the
 * `files:open` command and never flows through model state.
 */
export class FilesListModel extends ViewModel {
  path = "/";
  entries: FileInfo[] = [];
  loading = false;
  error: string | undefined = undefined;
  cursorIndex = 0;
  pageSize = 20;
  selectedPaths = new Set<string>();
  sortField: "name" | "size" | "lastModified" | "kind" = "name";
  sortAscending = true;
  filter = "";
  showHidden = false;

  startLoading(params: {
    path: string;
  }): (result: { entries?: FileInfo[]; error?: string }) => void {
    this.path = params.path;
    this.entries = [];
    this.error = undefined;
    this.loading = true;
    this.cursorIndex = 0;
    this.notify();

    return (result) => {
      this.loading = false;
      if (result.error) {
        this.error = result.error;
      } else if (result.entries) {
        this.entries = result.entries;
      }
      this.cursorIndex = 0;
      this.notify();
    };
  }

  moveCursor(delta: number): void {
    const visible = this.getVisibleEntries();
    if (visible.length === 0) return;
    const next = this.cursorIndex + delta;
    this.cursorIndex = Math.max(0, Math.min(next, visible.length - 1));
    this.notify();
  }

  getCursorEntry(): FileInfo | undefined {
    return this.getVisibleEntries()[this.cursorIndex];
  }

  toggleSelect(index: number): void {
    const entry = this.getVisibleEntries()[index];
    if (!entry || entry.name === "..") return;
    if (this.selectedPaths.has(entry.path)) {
      this.selectedPaths.delete(entry.path);
    } else {
      this.selectedPaths.add(entry.path);
    }
    this.notify();
  }

  selectRange(from: number, to: number): void {
    const visible = this.getVisibleEntries();
    const start = Math.max(0, Math.min(from, to));
    const end = Math.min(visible.length - 1, Math.max(from, to));
    for (let i = start; i <= end; i++) {
      const entry = visible[i];
      if (entry && entry.name !== "..") {
        this.selectedPaths.add(entry.path);
      }
    }
    this.notify();
  }

  clearSelection(): void {
    if (this.selectedPaths.size === 0) return;
    this.selectedPaths.clear();
    this.notify();
  }

  setSort(field: "name" | "size" | "lastModified" | "kind"): void {
    if (this.sortField === field) {
      this.sortAscending = !this.sortAscending;
    } else {
      this.sortField = field;
      this.sortAscending = true;
    }
    this.notify();
  }

  setFilter(pattern: string): void {
    this.filter = pattern;
    this.cursorIndex = 0;
    this.notify();
  }

  toggleHidden(): void {
    this.showHidden = !this.showHidden;
    this.cursorIndex = 0;
    this.notify();
  }

  getVisibleEntries(): FileInfo[] {
    let visible = this.entries;

    if (!this.showHidden) {
      visible = visible.filter((e) => e.name === ".." || !e.name.startsWith("."));
    }

    if (this.filter) {
      const lower = this.filter.toLowerCase();
      visible = visible.filter((e) => e.name === ".." || e.name.toLowerCase().includes(lower));
    }

    const dotdot = visible.find((e) => e.name === "..");
    const rest = visible.filter((e) => e.name !== "..");

    rest.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      let cmp = 0;
      switch (this.sortField) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "size":
          cmp = (a.size ?? 0) - (b.size ?? 0);
          break;
        case "lastModified":
          cmp = (a.lastModified ?? 0) - (b.lastModified ?? 0);
          break;
        case "kind":
          cmp = a.kind.localeCompare(b.kind);
          break;
      }
      return this.sortAscending ? cmp : -cmp;
    });

    return dotdot ? [dotdot, ...rest] : rest;
  }

  getDisplayEntries(): FileDisplayEntry[] {
    return this.getVisibleEntries().map((e) => toDisplayEntry(e));
  }

  getSelectedOrCursor(): string[] {
    if (this.selectedPaths.size > 0) {
      return [...this.selectedPaths];
    }
    const entry = this.getCursorEntry();
    if (entry && entry.name !== "..") {
      return [entry.path];
    }
    return [];
  }
}
