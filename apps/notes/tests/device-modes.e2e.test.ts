// Seam 2 (spec statewalker/statewalker-root#215, ticket statewalker/statewalker-root#253): the
// workbench's three device modes, chosen by the window's width, and the layouts it keeps per mode
// in system.profile (localStorage). The notes view opens in the centre (the app's default layout);
// the surfaces view prefers the right zone.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type StaticServer, serveStatic } from "../scripts/static-server.mjs";

const DIST = resolve(import.meta.dirname, "..", "dist");
const NOTES = "org.statewalker.notes";
const SURFACES = "org.statewalker.surfaces";
const NOTES_VIEW = `${NOTES}/notes`;
const SURFACES_VIEW = `${SURFACES}/surfaces`;

const PHONE = { width: 390, height: 844 };
const TABLET = { width: 820, height: 1180 };
const DESKTOP = { width: 1280, height: 800 };

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

/** A fresh profile (a new browser context) at `viewport`, the app loaded. */
async function open(
  viewport: { width: number; height: number },
  options: { hasTouch?: boolean } = {},
): Promise<Opened> {
  const context = await browser.newContext({ viewport, ...options });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(server.url);
  await page.getByTestId("workbench").waitFor();
  return { context, page, errors };
}

async function withApp(
  viewport: { width: number; height: number },
  body: (opened: Opened) => Promise<void>,
  options: { hasTouch?: boolean } = {},
) {
  const opened = await open(viewport, options);
  try {
    await body(opened);
    expect(opened.errors).toEqual([]);
  } finally {
    await opened.context.close();
  }
}

/** Reload the page (the same profile) and wait for the workbench. */
async function reload(page: Page) {
  await page.reload();
  await page.getByTestId("workbench").waitFor();
}

const mode = (page: Page) => page.getByTestId("workbench").getAttribute("data-mode");
const notesView = (page: Page) => page.getByTestId("notes-view");
const surfacesView = (page: Page) => page.getByTestId("surfaces-view");
const dockTab = (page: Page, title: string) => page.locator(".dv-tab", { hasText: title });
const tabBar = (page: Page) => page.getByRole("tablist", { name: "Views" });
const openView = (page: Page, id: string) =>
  page.evaluate((view) => window.platform.workbench.open(view), id);
const savedLayout = (page: Page, mode: string) =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
    `org.statewalker.apps.notes:workbench/layouts/${mode}`,
  );

describe("the device mode follows the window's width", () => {
  it("desktop: the menu bar, the activity bar and one dockview with zones", async () => {
    await withApp(DESKTOP, async ({ page }) => {
      await expect(mode(page)).resolves.toBe("desktop");
      await notesView(page).waitFor();
      await page.getByRole("menubar").waitFor();
      await page.getByTestId("activitybar").waitFor();
      await expect(dockTab(page, "Notes").count()).resolves.toBe(1);
      await expect(tabBar(page).count()).resolves.toBe(0);
      // The surfaces view prefers the right zone: a group right of the notes view.
      await openView(page, SURFACES_VIEW);
      await surfacesView(page).waitFor();
      const notesBox = await dockTab(page, "Notes").boundingBox();
      const surfacesBox = await dockTab(page, "Surfaces").boundingBox();
      expect(surfacesBox?.x).toBeGreaterThan((notesBox?.x ?? 0) + (notesBox?.width ?? 0));
      await expect(page.evaluate(() => window.platform.workbench.layout().zones)).resolves.toEqual({
        center: [NOTES_VIEW],
        left: [],
        right: [SURFACES_VIEW],
        bottom: [],
      });
    });
  });

  it("tablet: side zones as drawers, the centre a dockview whose panels drag by touch", async () => {
    await withApp(
      TABLET,
      async ({ page }) => {
        await expect(mode(page)).resolves.toBe("tablet");
        await notesView(page).waitFor();
        await expect(dockTab(page, "Notes").count()).resolves.toBe(1);
        // A right-zone view opens in the right drawer, not in the dock.
        await openView(page, SURFACES_VIEW);
        const drawer = page.getByRole("region", { name: "Right zone" });
        await drawer.waitFor();
        await drawer.getByTestId("surfaces-view").waitFor();
        await expect(dockTab(page, "Surfaces").count()).resolves.toBe(0);
        await drawer.getByRole("button", { name: "Close drawer" }).click();
        await drawer.waitFor({ state: "detached" });
        await page.getByRole("button", { name: "Right zone" }).click();
        await drawer.getByTestId("surfaces-view").waitFor();
        await drawer.getByRole("button", { name: "Close drawer" }).click();

        // Touch drag: a long press on the Notes tab, dragged to the right half of the dock,
        // splits it off into a group of its own.
        await page.evaluate((id) => window.platform.workbench.move(id, "center"), SURFACES_VIEW);
        await dockTab(page, "Surfaces").waitFor();
        await expect(page.locator(".dv-groupview").count()).resolves.toBe(1);
        const tab = await dockTab(page, "Notes").boundingBox();
        const dock = await page.locator(".dv-groupview").boundingBox();
        if (!tab || !dock) throw new Error("no tab or dock");
        await touchDrag(
          page,
          { x: tab.x + tab.width / 2, y: tab.y + tab.height / 2 },
          { x: dock.x + dock.width - 20, y: dock.y + dock.height / 2 },
        );
        await expect.poll(() => page.locator(".dv-groupview").count()).toBe(2);
      },
      { hasTouch: true },
    );
  });

  it("phone: one panel, a bottom tab bar, and a More menu", async () => {
    await withApp(PHONE, async ({ page }) => {
      await expect(mode(page)).resolves.toBe("phone");
      await notesView(page).waitFor();
      await expect(tabBar(page).getByRole("tab").allInnerTexts()).resolves.toEqual(["Notes"]);
      await expect(
        tabBar(page).getByRole("tab", { name: "Notes" }).getAttribute("aria-selected"),
      ).resolves.toBe("true");
      await expect(page.getByRole("menubar").count()).resolves.toBe(0);
      await expect(page.locator(".dv-tab").count()).resolves.toBe(0);

      // More: the views not open, and the menu bar's menus.
      await page.getByRole("button", { name: "More" }).click();
      const more = page.getByRole("menu");
      await more.getByRole("menuitem", { name: "Notes" }).waitFor(); // the menu bar's submenu
      await more.getByRole("menuitem", { name: "Surfaces" }).click();
      await surfacesView(page).waitFor();
      await expect(notesView(page).count()).resolves.toBe(0); // one panel at a time
      await expect(tabBar(page).getByRole("tab").allInnerTexts()).resolves.toEqual([
        "Notes",
        "Surfaces",
      ]);
      await tabBar(page).getByRole("tab", { name: "Notes" }).click();
      await notesView(page).waitFor();
      await expect(surfacesView(page).count()).resolves.toBe(0);
    });
  });
});

describe("layouts are remembered per device mode", () => {
  it("a layout changed in one mode survives a reload and leaves the other modes' alone", async () => {
    await withApp(DESKTOP, async ({ page }) => {
      await notesView(page).waitFor();
      await openView(page, SURFACES_VIEW);
      await surfacesView(page).waitFor();
      // The user closes the notes tab.
      await dockTab(page, "Notes").locator(".dv-default-tab-action").click();
      await expect.poll(() => dockTab(page, "Notes").count()).toBe(0);
      await expect(savedLayout(page, "desktop")).resolves.toMatchObject({
        version: 1,
        zones: { center: [], right: [SURFACES_VIEW] },
      });

      await reload(page);
      await surfacesView(page).waitFor();
      await expect(dockTab(page, "Notes").count()).resolves.toBe(0);

      // The phone's layout is still the default one: the notes view.
      await page.setViewportSize(PHONE);
      await expect.poll(() => mode(page)).toBe("phone");
      await notesView(page).waitFor();
      await expect(tabBar(page).getByRole("tab").allInnerTexts()).resolves.toEqual(["Notes"]);
      await expect(savedLayout(page, "phone")).resolves.toBeNull();
      await expect(savedLayout(page, "tablet")).resolves.toBeNull();

      await page.setViewportSize(DESKTOP);
      await expect.poll(() => mode(page)).toBe("desktop");
      await surfacesView(page).waitFor();
      await expect(dockTab(page, "Notes").count()).resolves.toBe(0);
    });
  });

  it("a panel dragged into another zone's group moves to that zone, and stays there", async () => {
    await withApp(DESKTOP, async ({ page }) => {
      await notesView(page).waitFor();
      await openView(page, SURFACES_VIEW);
      await surfacesView(page).waitFor();
      const target = await page.locator(".dv-groupview", { has: surfacesView(page) }).boundingBox();
      if (!target) throw new Error("no right zone");
      await dockTab(page, "Notes").hover();
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) {
        const box = await dockTab(page, "Notes").boundingBox();
        if (!box) break;
        await page.mouse.move(
          box.x + ((target.x + target.width / 2 - box.x) * i) / 10,
          box.y + ((target.y + target.height / 2 - box.y) * i) / 10,
        );
      }
      await page.mouse.up();
      await expect
        .poll(() => savedLayout(page, "desktop"))
        .toMatchObject({ zones: { center: [], right: [SURFACES_VIEW, NOTES_VIEW] } });
      await reload(page);
      await notesView(page).waitFor();
      await expect(page.evaluate(() => window.platform.workbench.layout().zones)).resolves.toEqual({
        center: [],
        left: [],
        right: [SURFACES_VIEW, NOTES_VIEW],
        bottom: [],
      });
    });
  });

  it("a saved layout drops the views of a removed fragment", async () => {
    await withApp(DESKTOP, async ({ page }) => {
      await notesView(page).waitFor();
      await openView(page, SURFACES_VIEW);
      await surfacesView(page).waitFor();
      await expect(savedLayout(page, "desktop")).resolves.toMatchObject({
        zones: { center: [NOTES_VIEW], right: [SURFACES_VIEW] },
      });
      await page.evaluate((id) => window.platform.kernel.remove(id), NOTES);
      await expect.poll(() => dockTab(page, "Notes").count()).toBe(0);
      await expect(savedLayout(page, "desktop")).resolves.toMatchObject({
        zones: { center: [], right: [SURFACES_VIEW] },
      });
      // The app installs notes again on boot; its view is no longer in the saved layout.
      await reload(page);
      await surfacesView(page).waitFor();
      await expect(
        page.evaluate((id) => window.platform.workbench.view(id) !== undefined, NOTES_VIEW),
      ).resolves.toBe(true);
      await expect(dockTab(page, "Notes").count()).resolves.toBe(0);
    });
  });
});

/** A touch drag through CDP: press, hold until dockview arms the drag, move in steps, release. */
async function touchDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const cdp = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => [{ x, y, id: 1, radiusX: 1, radiusY: 1, force: 1 }];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: point(from.x, from.y),
  });
  // Past dockview's 250ms arming delay, before its long press (the tab's context menu).
  await page.waitForTimeout(320);
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(x, y) });
    await page.waitForTimeout(30);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}
