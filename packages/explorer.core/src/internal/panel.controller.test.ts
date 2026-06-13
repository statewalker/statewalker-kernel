import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it } from "vitest";
import { createPanelController, parentPath } from "../public/panel.controller.js";

async function flush(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

const enc = new TextEncoder();
const bytes = (s: string): Uint8Array[] => [enc.encode(s)];

describe("parentPath", () => {
  it("collapses to root from a one-deep path", () => {
    expect(parentPath("/foo")).toBe("/");
  });
  it("strips a trailing slash before walking up", () => {
    expect(parentPath("/foo/bar/")).toBe("/foo");
  });
  it("returns root for root", () => {
    expect(parentPath("/")).toBe("/");
  });
});

describe("createPanelController", () => {
  it("loads root entries on construction and inserts a synthetic .. when navigating into a child", async () => {
    const files = new MemFilesApi();
    await files.write("/a.txt", bytes("hi"));
    await files.mkdir("/dir");
    await files.write("/dir/inner.txt", bytes("x"));

    const panel = createPanelController({ files, title: "Files" });
    await flush();

    const rootNames = panel.model.getVisibleEntries().map((e) => e.name);
    expect(rootNames).toContain("a.txt");
    expect(rootNames).toContain("dir");
    expect(rootNames).not.toContain("..");

    panel.navigate("/dir");
    await flush();

    const childNames = panel.model.getVisibleEntries().map((e) => e.name);
    expect(childNames).toContain("..");
    expect(childNames).toContain("inner.txt");
  });

  it("honours initialPath on construction", async () => {
    const files = new MemFilesApi();
    await files.write("/dir/x.txt", bytes("x"));
    const panel = createPanelController({ files, title: "Files", initialPath: "/dir" });
    await flush();

    expect(panel.model.path).toBe("/dir");
    expect(panel.model.getVisibleEntries().map((e) => e.name)).toContain("x.txt");
  });

  it("refresh re-navigates to the current path", async () => {
    const files = new MemFilesApi();
    await files.write("/a.txt", bytes("a"));
    const panel = createPanelController({ files, title: "Files" });
    await flush();

    await files.write("/b.txt", bytes("b"));
    panel.refresh();
    await flush();

    const names = panel.model.getVisibleEntries().map((e) => e.name);
    expect(names).toContain("b.txt");
  });
});
