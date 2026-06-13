import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it } from "vitest";
import { initWorkspace } from "../public/init-workspace.js";
import { Secrets } from "../public/types/secrets.js";
import { Settings } from "../public/types/settings.js";
import { SystemFiles } from "../public/types/system-files.js";
import { Workspace } from "../public/types/workspace.js";

const textEncoder = new TextEncoder();

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function build(root: MemFilesApi, label = "A"): Workspace {
  return initWorkspace({
    workspace: new Workspace(),
    filesApi: root,
    label,
  });
}

describe("FilesBackedSecrets", () => {
  it("round-trips a JSON value via the workspace adapter", async () => {
    const root = new MemFilesApi();
    const ws = build(root);
    await ws.open();

    const secrets = ws.requireAdapter(Secrets);
    await secrets.set("ai:provider:openai", { apiKey: "sk-test" });
    expect(await secrets.get("ai:provider:openai")).toEqual({
      apiKey: "sk-test",
    });
    expect(secrets.isLocked).toBe(false);
  });

  it("coalesces rapid writes into a single onUpdate callback", async () => {
    const root = new MemFilesApi();
    const ws = build(root);
    await ws.open();
    const secrets = ws.requireAdapter(Secrets);

    const calls: string[][] = [];
    secrets.onUpdate((keys) => calls.push([...keys]));

    await Promise.all([secrets.set("a", 1), secrets.set("b", 2), secrets.set("c", 3)]);
    await flushMicrotasks();

    expect(calls).toHaveLength(1);
    expect([...(calls[0] ?? [])].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("FilesBackedSettings", () => {
  it("round-trips values into a subtree distinct from Secrets", async () => {
    const root = new MemFilesApi();
    const ws = build(root);
    await ws.open();

    const settings = ws.requireAdapter(Settings);
    const secrets = ws.requireAdapter(Secrets);

    await settings.set("theme", "dark");
    await secrets.set("api-key", "s");

    expect((await settings.list()).sort()).toEqual(["theme"]);
    expect((await secrets.list()).sort()).toEqual(["api-key"]);

    expect(await root.exists("/.settings/settings/theme.json")).toBe(true);
    expect(await root.exists("/.settings/secrets/api-key.json")).toBe(true);
  });
});

describe("FilesBackedSystemFiles", () => {
  it("exposes the systemDir subtree via workspace.requireAdapter(SystemFiles)", async () => {
    const root = new MemFilesApi();
    await root.write("/README.md", [textEncoder.encode("hi")]);
    const ws = build(root);
    await ws.open();

    const systemFiles = ws.requireAdapter(SystemFiles).files;
    await systemFiles.write("/marker.txt", [textEncoder.encode("x")]);
    expect(await root.exists("/.settings/marker.txt")).toBe(true);

    // workspace.files is the raw root — system subtree is visible from it.
    const rootEntries: string[] = [];
    for await (const entry of ws.files.list("/")) rootEntries.push(entry.name);
    expect(rootEntries.sort()).toEqual([".settings", "README.md"]);
  });
});
