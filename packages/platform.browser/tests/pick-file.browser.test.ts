import { getCommands, PickFileCommand } from "@statewalker/platform.core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerPickFileBrowser } from "../src/handlers/pick-file.browser.js";

describe("pick-file browser handler — FS Access API path", () => {
  beforeEach(() => {
    delete (globalThis as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls showOpenFilePicker and returns blobs + names", async () => {
    const fileA = new File(["a"], "a.txt", { type: "text/plain" });
    const fileB = new File(["bb"], "b.md", { type: "text/markdown" });
    const handles = [
      { getFile: () => Promise.resolve(fileA) },
      { getFile: () => Promise.resolve(fileB) },
    ];
    const showOpenFilePicker = vi.fn(() => Promise.resolve(handles));
    (
      globalThis as unknown as { showOpenFilePicker: typeof showOpenFilePicker }
    ).showOpenFilePicker = showOpenFilePicker;

    const ctx = {};
    const unregister = registerPickFileBrowser(getCommands(ctx));
    try {
      const result = await getCommands(ctx).call(PickFileCommand, {
        multiple: true,
        accept: [".txt", ".md"],
      }).promise;
      expect(showOpenFilePicker).toHaveBeenCalledOnce();
      expect(result.names).toEqual(["a.txt", "b.md"]);
      expect(result.blobs).toHaveLength(2);
      expect(result.blobs[0]).toBeInstanceOf(Blob);
    } finally {
      unregister();
    }
  });
});

describe("pick-file browser handler — input element fallback", () => {
  beforeEach(() => {
    delete (globalThis as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  });

  it("falls back to <input type=file> when FS Access API is unavailable", async () => {
    const file = new File(["hi"], "note.txt", { type: "text/plain" });

    // Intercept input.click() to simulate user selecting the file.
    const originalCreate = document.createElement.bind(document);
    const createSpy = vi
      .spyOn(document, "createElement")
      .mockImplementation((tag: string, options?: ElementCreationOptions) => {
        const el = originalCreate(tag, options);
        if (tag === "input") {
          const input = el as HTMLInputElement;
          input.click = () => {
            // Attach the file and dispatch change.
            Object.defineProperty(input, "files", {
              value: {
                length: 1,
                0: file,
                [Symbol.iterator]: function* () {
                  yield file;
                },
              },
              configurable: true,
            });
            input.dispatchEvent(new Event("change"));
          };
        }
        return el;
      });

    const ctx = {};
    const unregister = registerPickFileBrowser(getCommands(ctx));
    try {
      const result = await getCommands(ctx).call(PickFileCommand, { accept: [".txt"] }).promise;
      expect(result.names).toEqual(["note.txt"]);
      expect(result.blobs).toHaveLength(1);
    } finally {
      unregister();
      createSpy.mockRestore();
    }
  });
});
