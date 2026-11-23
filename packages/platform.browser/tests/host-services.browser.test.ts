// The browser's host services (system.host's defaults): the clipboard, the file picker and the URL
// state, over the same handlers the platform:* commands use.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserHostServices } from "../src/index.js";

describe("browser host services", () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText, readText: () => Promise.resolve("pasted") },
      configurable: true,
    });
    history.replaceState(null, "", "#");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes to and reads from the clipboard", async () => {
    const services = createBrowserHostServices();
    try {
      await services.clipboard.writeText("Buy milk");
      expect(writeText).toHaveBeenCalledWith("Buy milk");
      await expect(services.clipboard.readText()).resolves.toBe("pasted");
    } finally {
      services.close();
    }
  });

  it("refuses a clipboard write the browser refuses", async () => {
    writeText.mockRejectedValueOnce(new Error("permission denied"));
    const services = createBrowserHostServices();
    try {
      await expect(services.clipboard.writeText("x")).rejects.toThrow("permission denied");
    } finally {
      services.close();
    }
  });

  it("picks files through an input element where the browser has no file picker API", async () => {
    const services = createBrowserHostServices();
    try {
      const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (
        this: HTMLInputElement,
      ) {
        this.dispatchEvent(new Event("cancel"));
      });
      await expect(services.files.pickFile({ accept: [".md"] })).resolves.toEqual({
        blobs: [],
        names: [],
      });
      expect(click).toHaveBeenCalledOnce();
    } finally {
      services.close();
    }
  });

  it("keeps the URL state in the hash and tells observers of each change", async () => {
    history.replaceState(null, "", "#/notes?views=a");
    const services = createBrowserHostServices();
    try {
      await expect(services.urlState.read()).resolves.toEqual({
        path: "/notes",
        query: { views: "a" },
      });
      const seen: unknown[] = [];
      const stop = services.urlState.observe((state) => seen.push(state));
      await services.urlState.write({ path: "/notes", query: { views: "a,b" } }, { replace: true });
      expect(location.hash).toBe("#/notes?views=a%2Cb");
      const length = history.length;
      await services.urlState.write({ path: "/x", query: {} });
      expect(history.length).toBe(length + 1);
      // Writing the state the URL holds changes nothing.
      await services.urlState.write({ path: "/x", query: {} });
      // A navigation from outside (a link, back and forward) reaches observers too.
      location.hash = "#/y";
      await vi.waitFor(() => expect(seen).toHaveLength(3));
      stop();
      expect(seen).toEqual([
        { path: "/notes", query: { views: "a,b" } },
        { path: "/x", query: {} },
        { path: "/y", query: {} },
      ]);
    } finally {
      services.close();
    }
  });
});
