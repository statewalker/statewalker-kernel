import { getCommands, PickDirectoryCommand, UserCancelledError } from "@statewalker/platform.core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPickDirectoryBrowser } from "../src/handlers/pick-directory.browser.js";

describe("pick-directory browser handler", () => {
  beforeEach(() => {
    // Reset between tests: strip any previous stub.
    delete (globalThis as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("invokes showDirectoryPicker and resolves with files + label", async () => {
    const fakeHandle = {
      name: "my-workspace",
      kind: "directory" as const,
      queryPermission: () => Promise.resolve("granted"),
      requestPermission: () => Promise.resolve("granted"),
    };
    const showDirectoryPicker = vi.fn(() => Promise.resolve(fakeHandle));
    (
      globalThis as unknown as { showDirectoryPicker: typeof showDirectoryPicker }
    ).showDirectoryPicker = showDirectoryPicker;

    const ctx = {};
    const unregister = registerPickDirectoryBrowser(getCommands(ctx));
    try {
      const result = await getCommands(ctx).call(PickDirectoryCommand, { title: "pick" }).promise;
      expect(showDirectoryPicker).toHaveBeenCalledOnce();
      expect(result.label).toBe("my-workspace");
      // BrowserFilesApi exposes the FilesApi contract — we only check the constructor ran
      // without throwing. Any deep behavior is covered by webrun-files-browser tests.
      expect(typeof result.files.list).toBe("function");
    } finally {
      unregister();
    }
  });

  it("rejects when showDirectoryPicker is unavailable", async () => {
    const ctx = {};
    const unregister = registerPickDirectoryBrowser(getCommands(ctx));
    try {
      await expect(getCommands(ctx).call(PickDirectoryCommand, {}).promise).rejects.toThrow(
        /showDirectoryPicker is not available/,
      );
    } finally {
      unregister();
    }
  });

  it("maps AbortError onto UserCancelledError when the user dismisses", async () => {
    (globalThis as unknown as { showDirectoryPicker: () => Promise<never> }).showDirectoryPicker =
      () => Promise.reject(new DOMException("The user aborted a request.", "AbortError"));
    const ctx = {};
    const unregister = registerPickDirectoryBrowser(getCommands(ctx));
    try {
      await expect(getCommands(ctx).call(PickDirectoryCommand, {}).promise).rejects.toBeInstanceOf(
        UserCancelledError,
      );
    } finally {
      unregister();
    }
  });

  it("passes non-AbortError rejections through unchanged", async () => {
    const original = new Error("permission denied");
    (globalThis as unknown as { showDirectoryPicker: () => Promise<never> }).showDirectoryPicker =
      () => Promise.reject(original);
    const ctx = {};
    const unregister = registerPickDirectoryBrowser(getCommands(ctx));
    try {
      await expect(getCommands(ctx).call(PickDirectoryCommand, {}).promise).rejects.toBe(original);
    } finally {
      unregister();
    }
  });

  it("recognises a plain object whose name is AbortError as cancellation", async () => {
    (globalThis as unknown as { showDirectoryPicker: () => Promise<never> }).showDirectoryPicker =
      () => Promise.reject({ name: "AbortError", message: "shaped like a DOMException" });
    const ctx = {};
    const unregister = registerPickDirectoryBrowser(getCommands(ctx));
    try {
      await expect(getCommands(ctx).call(PickDirectoryCommand, {}).promise).rejects.toBeInstanceOf(
        UserCancelledError,
      );
    } finally {
      unregister();
    }
  });
});
