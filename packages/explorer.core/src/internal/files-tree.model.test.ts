import type { FileInfo } from "@statewalker/webrun-files";
import { describe, expect, it } from "vitest";
import { FilesTreeView } from "../public/files-tree.model.js";

function entry(name: string, kind: "file" | "directory" = "file"): FileInfo {
  return { name, path: `/${name}`, kind };
}

describe("FilesTreeView", () => {
  it("queues lazy expand on first toggle of an unloaded directory", () => {
    const tree = new FilesTreeView();
    tree.setRootNodes([entry("a", "directory")]);
    const node = tree.nodes[0];
    if (!node) throw new Error("expected one root node");
    tree.toggleExpand(node);
    expect(tree.consumeExpand()).toBe(node);
    expect(node.loading).toBe(true);
  });

  it("expands without re-queuing when children are cached", () => {
    const tree = new FilesTreeView();
    tree.setRootNodes([entry("a", "directory")]);
    const node = tree.nodes[0];
    if (!node) throw new Error("expected one root node");
    tree.setNodeChildren(node, [entry("inner")]);
    expect(node.expanded).toBe(true);
    tree.toggleExpand(node);
    expect(node.expanded).toBe(false);
    tree.toggleExpand(node);
    expect(node.expanded).toBe(true);
    expect(tree.consumeExpand()).toBeNull();
  });

  it("hides dot-prefixed nodes unless showHidden is on", () => {
    const tree = new FilesTreeView();
    tree.setRootNodes([entry("a"), entry(".hidden"), entry("b")]);
    expect(tree.getVisibleNodes().map((n) => n.entry.name)).toEqual(["a", "b"]);
    tree.toggleHidden();
    expect(tree.getVisibleNodes().map((n) => n.entry.name)).toEqual(["a", ".hidden", "b"]);
  });
});
