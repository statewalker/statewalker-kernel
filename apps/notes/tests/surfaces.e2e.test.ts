// Seam 2 (spec statewalker/statewalker-root#215): A2UI surfaces end to end, through apps/notes in
// Chromium. The surfaces demo fragment places a surface with its NoteEditor (CodeMirror) bound to
// the surface's data model; the tests update it as an agent would, pop it out into the dock and
// back. The app is the built `dist/` (`pnpm run build`), served as static files.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type StaticServer, serveStatic } from "../scripts/static-server.mjs";

const DIST = resolve(import.meta.dirname, "..", "dist");
const SURFACES_VIEW = "org.statewalker.surfaces/surfaces";
const SURFACE = "demo";
const TITLE = "Trip notes";

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

/** Open the app and the surfaces demo's view; wait for its surface's editor. */
async function open(): Promise<{ page: Page; errors: string[] }> {
  const page = await browser.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(server.url);
  await page.getByTestId("workbench").waitFor();
  await page.evaluate((id) => window.platform.workbench.open(id), SURFACES_VIEW);
  await inline(page).locator(".cm-content").waitFor();
  return { page, errors };
}

/** The surface where its sender placed it (the demo view), not in the dock. */
const inline = (page: Page) =>
  page.locator(`[data-surface-view="${SURFACE}"][data-where="inline"]`);
const docked = (page: Page) => page.locator(`[data-surface-view="${SURFACE}"][data-where="dock"]`);

/** The editor's document, as the user sees it. */
const text = (page: Page, where = inline(page)) =>
  where.locator(".cm-content").evaluate((el) => (el as HTMLElement).innerText.replace(/\n$/, ""));

/** The surface's bound document in its data model (what the agent sees). */
const bound = (page: Page) =>
  page.evaluate(
    (id) => window.platform.a2ui.surface(id)?.dataModel.get("/doc/text") as string,
    SURFACE,
  );

/** An agent's update of the bound document, built from the data model. */
const agentPrepends = (page: Page, line: string) =>
  page.evaluate(
    async ({ id, line }) => {
      const current = window.platform.a2ui.surface(id)?.dataModel.get("/doc/text") as string;
      const { errors } = await window.platform.a2ui.process(
        {
          version: "1.0",
          updateDataModel: { surfaceId: id, path: "/doc/text", value: `${line}\n${current}` },
        },
        { origin: "agent" },
      );
      return errors;
    },
    { id: SURFACE, line },
  );

describe("A2UI surfaces in apps/notes", () => {
  it("an editable component keeps its cursor and undo history when the agent updates the surface", async () => {
    const { page, errors } = await open();
    try {
      const editor = inline(page).locator(".cm-content");
      await page.evaluate(() => {
        (document.querySelector(".cm-editor") as HTMLElement & { marked?: boolean }).marked = true;
      });
      await editor.click();
      await page.keyboard.press("Control+End");
      await page.keyboard.type(" typed");
      // Two-way binding: the typing reaches the data model the agent builds its push from.
      await expect.poll(() => bound(page)).toMatch(/ typed$/);

      expect(await agentPrepends(page, "AGENT")).toEqual([]);
      await expect.poll(() => text(page)).toMatch(/^AGENT\n[\s\S]* typed$/);
      // The same editor, not a new one.
      expect(
        await page.evaluate(
          () => (document.querySelector(".cm-editor") as HTMLElement & { marked?: boolean }).marked,
        ),
      ).toBe(true);
      // The cursor stayed after the user's text: typing goes on there.
      await page.keyboard.type("!");
      await expect.poll(() => text(page)).toMatch(/ typed!$/);
      // Undo takes back the user's own typing, and only it: the agent's line stays.
      for (let i = 0; i < 5 && (await text(page)).includes("typed"); i++) {
        await page.keyboard.press("Control+z");
      }
      const after = await text(page);
      expect(after).not.toContain("typed");
      expect(after.startsWith("AGENT\n")).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it("the user pops a surface out into the dock and back", async () => {
    const { page, errors } = await open();
    try {
      await inline(page).locator(".cm-content").click();
      await page.keyboard.press("Control+End");
      await page.keyboard.type(" kept");
      await expect.poll(() => bound(page)).toMatch(/ kept$/);

      await inline(page).getByRole("button", { name: "Pop out" }).click();
      await docked(page).locator(".cm-content").waitFor();
      await expect(page.locator(".dv-tab", { hasText: TITLE }).count()).resolves.toBe(1);
      await page.locator(`[data-surface-placeholder="${SURFACE}"]`).waitFor();
      await expect(inline(page).count()).resolves.toBe(0);
      // The bound document came along.
      await expect.poll(() => text(page, docked(page))).toMatch(/ kept$/);

      await docked(page).getByRole("button", { name: "Back inline" }).click();
      await inline(page).locator(".cm-content").waitFor();
      await expect(page.locator(".dv-tab", { hasText: TITLE }).count()).resolves.toBe(0);
      await expect(docked(page).count()).resolves.toBe(0);
      await expect.poll(() => text(page)).toMatch(/ kept$/);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it("system.workbench/open-surface pops a surface out; closing its tab brings it back", async () => {
    const { page, errors } = await open();
    try {
      await page.evaluate(
        (id) => window.platform.commands.call("system.workbench/open-surface", { surfaceId: id }),
        SURFACE,
      );
      await docked(page).locator(".cm-content").waitFor();
      await page.locator(`[data-surface-placeholder="${SURFACE}"]`).waitFor();

      // The user closes the dock's tab.
      await page.locator(".dv-tab", { hasText: TITLE }).locator(".dv-default-tab-action").click();
      await inline(page).locator(".cm-content").waitFor();
      await expect(docked(page).count()).resolves.toBe(0);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it("an agent's surface placing an unknown component or raw HTML is refused", async () => {
    const { page, errors } = await open();
    try {
      const result = await page.evaluate(() =>
        window.platform.a2ui.process(
          {
            version: "1.0",
            createSurface: {
              surfaceId: "evil",
              catalogId: window.platform.a2ui.catalogId,
              components: [
                { id: "root", component: "Column", children: ["x"] },
                { id: "x", component: "Html", html: "<img src=x onerror=alert(1)>" },
              ],
            },
          },
          { origin: "agent" },
        ),
      );
      expect(result.surfaceIds).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.platform.a2ui.surface("evil"))).toBeUndefined();
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });
});
