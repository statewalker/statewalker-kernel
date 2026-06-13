import {
  COPY_TO_CLIPBOARD_COMMAND_KEY,
  CopyToClipboardCommand,
  DOWNLOAD_BLOB_COMMAND_KEY,
  DOWNLOAD_TO_FILES_COMMAND_KEY,
  getCommands,
  PICK_DIRECTORY_COMMAND_KEY,
  PICK_FILE_COMMAND_KEY,
  PREFERENCE_GET_COMMAND_KEY,
  PREFERENCE_SET_COMMAND_KEY,
  PreferenceSetCommand,
} from "@statewalker/platform.core";
import { Command, passthrough } from "@statewalker/shared-commands";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import initPlatformWeb from "../src/index.js";

const PLATFORM_COMMAND_KEYS = [
  PICK_DIRECTORY_COMMAND_KEY,
  PICK_FILE_COMMAND_KEY,
  DOWNLOAD_TO_FILES_COMMAND_KEY,
  COPY_TO_CLIPBOARD_COMMAND_KEY,
  DOWNLOAD_BLOB_COMMAND_KEY,
  PREFERENCE_GET_COMMAND_KEY,
  PREFERENCE_SET_COMMAND_KEY,
];

describe("platform.browser initPlatformWeb(ctx)", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(() => Promise.resolve()) },
      configurable: true,
    });
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("registers all seven handlers and cleanup unregisters them", async () => {
    const ctx: Record<string, unknown> = {};
    const cleanup = initPlatformWeb(ctx);
    expect(cleanup).toBeTypeOf("function");

    // Quick sanity: two handler-backed commands resolve after init.
    await expect(
      getCommands(ctx).call(CopyToClipboardCommand, { text: "x" }).promise,
    ).resolves.toBeUndefined();
    await expect(
      getCommands(ctx).call(PreferenceSetCommand, { key: "t", value: 1 }).promise,
    ).resolves.toBeUndefined();

    // After cleanup, every platform command stays unsettled (no listener,
    // silent policy leaves it pending so the caller can supply external
    // resolution if needed).
    await cleanup();
    for (const key of PLATFORM_COMMAND_KEYS) {
      const decl = Command.silent(key)
        .input(passthrough<Record<string, unknown>>())
        .output(passthrough<unknown>())
        .build();
      const cmd = getCommands(ctx).call(decl, {});
      await Promise.resolve();
      expect(cmd.settled).toBe(false);
    }
  });
});
