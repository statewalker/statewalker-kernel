import { DownloadBlobCommand, getCommands } from "@statewalker/platform.core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerDownloadBlobBrowser } from "../src/handlers/download-blob.browser.js";

describe("download-blob browser handler", () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => "blob:mock-url");
    revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      value: createObjectURL,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: revokeObjectURL,
      configurable: true,
      writable: true,
    });
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates an anchor, clicks it, removes it, and revokes the object URL", async () => {
    vi.useFakeTimers();
    const ctx = {};
    const unregister = registerDownloadBlobBrowser(getCommands(ctx));
    try {
      const blob = new Blob(["payload"], { type: "text/plain" });
      await getCommands(ctx).call(DownloadBlobCommand, { blob, filename: "file.txt" }).promise;

      expect(createObjectURL).toHaveBeenCalledWith(blob);
      expect(clickSpy).toHaveBeenCalledOnce();
      expect(document.querySelectorAll("a").length).toBe(0);

      // The revoke happens on the next macrotask.
      vi.runAllTimers();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    } finally {
      unregister();
      vi.useRealTimers();
    }
  });
});
