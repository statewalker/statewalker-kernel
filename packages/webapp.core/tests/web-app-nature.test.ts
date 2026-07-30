import { describe, expect, it } from "vitest";
import { cacheFilesOf, systemFolderOf } from "../src/prefix-files-api.js";
import { WebAppNature } from "../src/web-app-nature.js";
import { HELLO_WORLD_FILES, setupProject, snapshot } from "./util/web-app-fixture.js";

describe("WebAppNature", () => {
  it("exists() is true for a convention web-app, false otherwise", async () => {
    const { project } = await setupProject();
    expect(await new WebAppNature(project).exists()).toBe(true);

    const other = await setupProject({ "package.json": "{}", "readme.md": "hi" });
    expect(await new WebAppNature(other.project).exists()).toBe(false);
  });

  it("scan() on a never-built project populates .project/webapp (t/<target>, lock.json)", async () => {
    const { project } = await setupProject();
    await new WebAppNature(project).scan();

    const cache = cacheFilesOf(project);
    expect(await cache.exists("/t/browser")).toBe(true);
    expect(await cache.exists("/lock.json")).toBe(true);
  });

  it("a second scan() over an unchanged project is a no-op (cache byte-identical)", async () => {
    const { project } = await setupProject();
    const nature = new WebAppNature(project);
    await nature.scan();

    const cache = cacheFilesOf(project);
    const before = await snapshot(cache);
    await nature.scan();
    const after = await snapshot(cache);

    expect(after).toEqual(before);
  });

  it("scan() on a non-web-app project registers no builders and writes nothing under .project", async () => {
    // No server/index.ts, no override → not a web-app.
    const { project, workspace } = await setupProject({
      "package.json": JSON.stringify({ name: "not-an-app" }),
      "client/index.html": "<!doctype html>",
    });
    await new WebAppNature(project).scan();

    expect(await workspace.files.exists(systemFolderOf(project))).toBe(false);
  });
});

// Sanity: the fixture really is a web-app so the negative test above is meaningful.
describe("HELLO_WORLD_FILES fixture", () => {
  it("has the three convention files", () => {
    expect(HELLO_WORLD_FILES["package.json"]).toBeDefined();
    expect(HELLO_WORLD_FILES["client/index.html"]).toBeDefined();
    expect(HELLO_WORLD_FILES["server/index.ts"]).toBeDefined();
  });
});
