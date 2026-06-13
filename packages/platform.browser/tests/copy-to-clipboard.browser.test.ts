import { CopyToClipboardCommand, getCommands } from "@statewalker/platform.core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCopyToClipboardBrowser } from "../src/handlers/copy-to-clipboard.browser.js";

describe("copy-to-clipboard browser handler", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves after navigator.clipboard.writeText succeeds", async () => {
    const ctx = {};
    const unregister = registerCopyToClipboardBrowser(getCommands(ctx));
    try {
      await getCommands(ctx).call(CopyToClipboardCommand, { text: "hello" }).promise;
      expect(writeText).toHaveBeenCalledWith("hello");
    } finally {
      unregister();
    }
  });

  it("rejects when writeText fails", async () => {
    const ctx = {};
    writeText.mockRejectedValueOnce(new Error("permission denied"));
    const unregister = registerCopyToClipboardBrowser(getCommands(ctx));
    try {
      await expect(
        getCommands(ctx).call(CopyToClipboardCommand, { text: "x" }).promise,
      ).rejects.toThrow("permission denied");
    } finally {
      unregister();
    }
  });

  it("unregister leaves subsequent fires unsettled (noop default)", () => {
    const ctx = {};
    const unregister = registerCopyToClipboardBrowser(getCommands(ctx));
    unregister();
    const command = getCommands(ctx).call(CopyToClipboardCommand, { text: "x" });
    expect(command.settled).toBe(false);
  });
});
