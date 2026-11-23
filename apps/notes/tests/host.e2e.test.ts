// Seam 2 (statewalker/statewalker-root#258): system.host's services in apps/notes, in Chromium.
// The notes view copies a note through the clipboard service; the shell keeps the open views in
// the URL state, so a reload (or a link) opens them again. The app is the built `dist/`.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type StaticServer, serveStatic } from "../scripts/static-server.mjs";

const DIST = resolve(import.meta.dirname, "..", "dist");
const NOTES_VIEW = "org.statewalker.notes/notes";
const SURFACES_VIEW = "org.statewalker.surfaces/surfaces";

let server: StaticServer;
let browser: Browser;

beforeAll(async () => {
  if (!existsSync(join(DIST, "index.html"))) {
    throw new Error(`no build at ${DIST}: run \`pnpm run build\` in apps/notes first`);
  }
  server = await serveStatic(DIST);
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

interface Opened {
  context: BrowserContext;
  page: Page;
  errors: string[];
}

/** Open the app at `hash`, in a context allowed to use the clipboard. */
async function open(hash = ""): Promise<Opened> {
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`${server.url}${hash}`);
  await page.getByTestId("workbench").waitFor();
  return { context, page, errors };
}

/** The views the workbench has open. */
function opened(page: Page): Promise<string[]> {
  return page.evaluate(() => [...window.platform.workbench.opened()]);
}

describe("host services in apps/notes", () => {
  it("copies a note through the clipboard service", async () => {
    const { context, page, errors } = await open();
    try {
      const view = page.getByTestId("notes-view");
      await view.getByRole("textbox").fill("Buy milk");
      await view.getByRole("button", { name: "Add note" }).click();
      const note = view.getByRole("listitem").filter({ hasText: "Buy milk" });
      await note.getByRole("button", { name: "Copy" }).click();
      await page.waitForFunction(async () => (await navigator.clipboard.readText()) === "Buy milk");
      // No fragment contributes a clipboard: the shell's own (the browser's) answered.
      await expect(page.evaluate(() => window.platform.host.provider("clipboard"))).resolves.toBe(
        undefined,
      );
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it("keeps the open views in the URL, and opens them again on reload", async () => {
    const { context, page, errors } = await open();
    try {
      await page.getByTestId("notes-view").waitFor();
      await page.evaluate((id) => window.platform.workbench.open(id), SURFACES_VIEW);
      await page.getByTestId("surfaces-view").waitFor();
      await page.waitForFunction(
        (id) => new URLSearchParams(location.hash.split("?")[1] ?? "").get("views")?.includes(id),
        SURFACES_VIEW,
      );

      await page.reload();
      await page.getByTestId("surfaces-view").waitFor();
      // Both views are open again, in their order (the notes tab behind the surfaces one).
      await expect(opened(page)).resolves.toEqual([NOTES_VIEW, SURFACES_VIEW]);
      await expect(page.locator(".dv-tab", { hasText: "Notes" }).count()).resolves.toBe(1);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it("restores the views a URL names instead of the default layout", async () => {
    const hash = `#?${new URLSearchParams({ views: SURFACES_VIEW })}`;
    const { context, page, errors } = await open(hash);
    try {
      await page.getByTestId("surfaces-view").waitFor();
      await expect(opened(page)).resolves.toEqual([SURFACES_VIEW]);
      await expect(page.getByTestId("notes-view").count()).resolves.toBe(0);

      // Navigating to another URL state opens and closes views to match.
      await page.evaluate((views) => {
        location.hash = `#?${new URLSearchParams({ views })}`;
      }, NOTES_VIEW);
      await page.getByTestId("notes-view").waitFor();
      await page.getByTestId("surfaces-view").waitFor({ state: "detached" });
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
