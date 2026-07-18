import {
  getCommands,
  PreferenceGetCommand,
  PreferenceSetCommand,
} from "@statewalker/platform.core";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { Workspace } from "@statewalker/workspace.core";
import { describe, expect, it } from "vitest";
import initPlatformNode from "../src/index.js";

/** A boot context with just a Workspace — the Commands bus auto-instantiates. */
function newCtx(): Record<string, unknown> {
  return { "workspace:workspace": new Workspace() };
}

describe("initPlatformNode — filesystem-backed preferences", () => {
  it("round-trips a preference through a FilesApi", async () => {
    const ctx = newCtx();
    const cleanup = initPlatformNode(ctx, { preferences: new MemFilesApi() });
    const commands = getCommands(ctx);

    await commands.call(PreferenceSetCommand, { key: "theme", value: "dark" }).promise;
    const got = await commands.call(PreferenceGetCommand, { key: "theme" }).promise;
    expect(got.value).toBe("dark");

    cleanup();
  });

  it("returns undefined for an absent key without rejecting", async () => {
    const ctx = newCtx();
    const cleanup = initPlatformNode(ctx, { preferences: new MemFilesApi() });

    const got = await getCommands(ctx).call(PreferenceGetCommand, { key: "nope" }).promise;
    expect(got.value).toBeUndefined();

    cleanup();
  });

  it("persists across re-init against the same FilesApi", async () => {
    const files = new MemFilesApi();

    const ctx1 = newCtx();
    const c1 = initPlatformNode(ctx1, { preferences: files });
    await getCommands(ctx1).call(PreferenceSetCommand, { key: "lang", value: "en" }).promise;
    c1();

    const ctx2 = newCtx();
    const c2 = initPlatformNode(ctx2, { preferences: files });
    const got = await getCommands(ctx2).call(PreferenceGetCommand, { key: "lang" }).promise;
    expect(got.value).toBe("en");
    c2();
  });
});
