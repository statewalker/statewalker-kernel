import type { FileInfo } from "@statewalker/webrun-files";
import { ViewModel } from "./view-model.js";

export interface TreeNode {
  entry: FileInfo;
  depth: number;
  expanded: boolean;
  children: TreeNode[] | undefined;
  loading: boolean;
}

/**
 * Reactive tree-state for the file-explorer panel's tree mode. Owns
 * the expanded set, the children cache, and a `pendingExpand` slot
 * the panel orchestrator consumes to lazy-load children via the
 * `FilesApi`.
 */
export class FilesTreeView extends ViewModel {
  root = "/";
  nodes: TreeNode[] = [];
  cursorIndex = 0;
  showHidden = false;

  pendingExpand: TreeNode | null = null;
  pendingSelectFile: string | null = null;

  setRoot(path: string): void {
    this.root = path;
    this.nodes = [];
    this.cursorIndex = 0;
    this.notify();
  }

  setRootNodes(entries: FileInfo[]): void {
    this.nodes = entries.map((entry) => ({
      entry,
      depth: 0,
      expanded: false,
      children: entry.kind === "directory" ? undefined : [],
      loading: false,
    }));
    this.cursorIndex = 0;
    this.notify();
  }

  getVisibleNodes(): TreeNode[] {
    const result: TreeNode[] = [];
    const collect = (nodes: TreeNode[]): void => {
      for (const node of nodes) {
        if (!this.showHidden && node.entry.name.startsWith(".")) continue;
        result.push(node);
        if (node.expanded && node.children) {
          collect(node.children);
        }
      }
    };
    collect(this.nodes);
    return result;
  }

  getCursorNode(): TreeNode | undefined {
    return this.getVisibleNodes()[this.cursorIndex];
  }

  moveCursor(delta: number): void {
    const visible = this.getVisibleNodes();
    if (visible.length === 0) return;
    const next = this.cursorIndex + delta;
    this.cursorIndex = Math.max(0, Math.min(next, visible.length - 1));
    this.notify();
  }

  toggleExpand(node: TreeNode): void {
    if (node.entry.kind !== "directory") return;
    if (node.expanded) {
      node.expanded = false;
      this.notify();
      return;
    }
    if (node.children === undefined) {
      this.pendingExpand = node;
      node.loading = true;
      this.notify();
    } else {
      node.expanded = true;
      this.notify();
    }
  }

  setNodeChildren(node: TreeNode, entries: FileInfo[]): void {
    node.children = entries.map((entry) => ({
      entry,
      depth: node.depth + 1,
      expanded: false,
      children: entry.kind === "directory" ? undefined : [],
      loading: false,
    }));
    node.loading = false;
    node.expanded = true;
    this.notify();
  }

  consumeExpand(): TreeNode | null {
    const node = this.pendingExpand;
    this.pendingExpand = null;
    return node;
  }

  activateCursorEntry(): void {
    const node = this.getCursorNode();
    if (!node) return;
    if (node.entry.kind === "directory") {
      this.toggleExpand(node);
    } else {
      this.pendingSelectFile = node.entry.path;
      this.notify();
    }
  }

  consumeSelectFile(): string | null {
    const path = this.pendingSelectFile;
    this.pendingSelectFile = null;
    return path;
  }

  toggleHidden(): void {
    this.showHidden = !this.showHidden;
    this.cursorIndex = 0;
    this.notify();
  }
}
