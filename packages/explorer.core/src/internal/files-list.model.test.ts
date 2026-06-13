import type { FileInfo } from "@statewalker/webrun-files";
import { describe, expect, it } from "vitest";
import { FilesListModel } from "../public/files-list.model.js";

function entry(name: string, kind: "file" | "directory" = "file"): FileInfo {
  return { name, path: `/${name}`, kind };
}

describe("FilesListModel", () => {
  it("hides dot-files unless showHidden is on", () => {
    const m = new FilesListModel();
    m.entries = [entry("a"), entry(".hidden"), entry("b")];
    expect(m.getVisibleEntries().map((e) => e.name)).toEqual(["a", "b"]);
    m.toggleHidden();
    expect(m.getVisibleEntries().map((e) => e.name)).toEqual([".hidden", "a", "b"]);
  });

  it("sorts directories before files, name ascending by default", () => {
    const m = new FilesListModel();
    m.entries = [
      entry("z.txt"),
      entry("dir-b", "directory"),
      entry("a.txt"),
      entry("dir-a", "directory"),
    ];
    expect(m.getVisibleEntries().map((e) => e.name)).toEqual(["dir-a", "dir-b", "a.txt", "z.txt"]);
  });

  it("flips sort direction when re-clicking the same field", () => {
    const m = new FilesListModel();
    m.entries = [entry("a"), entry("b")];
    m.setSort("name");
    expect(m.sortAscending).toBe(false);
  });

  it("filters by case-insensitive substring", () => {
    const m = new FilesListModel();
    m.entries = [entry("Foo"), entry("BAR"), entry("baz")];
    m.setFilter("a");
    expect(
      m
        .getVisibleEntries()
        .map((e) => e.name)
        .sort(),
    ).toEqual(["BAR", "baz"]);
  });

  it("returns selected paths when present, falls back to cursor entry", () => {
    const m = new FilesListModel();
    m.entries = [entry("a"), entry("b"), entry("c")];
    m.cursorIndex = 1;
    expect(m.getSelectedOrCursor()).toEqual(["/b"]);
    m.toggleSelect(0);
    m.toggleSelect(2);
    expect(m.getSelectedOrCursor().sort()).toEqual(["/a", "/c"]);
  });

  it("notify bumps version (drives useSyncExternalStore)", () => {
    const m = new FilesListModel();
    const before = m.version;
    m.notify();
    expect(m.version).toBeGreaterThan(before);
  });
});
