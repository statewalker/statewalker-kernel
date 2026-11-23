// Seam 2 (spec statewalker/statewalker-root#215): the application definition end to end, through
// apps/notes in Chromium: its brand in light and dark (system.appearance), its baseline fragments
// installed on first run, disableable but not removable, and its default layout. Each test opens
// a new browser context, so it starts from a fresh profile. The app is the built `dist/`.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import application from "../application.json" with { type: "json" };
import { type StaticServer, serveStatic } from "../scripts/static-server.mjs";

const DIST = resolve(import.meta.dirname, "..", "dist");
const NOTES = "org.statewalker.notes";
const SURFACES = "org.statewalker.surfaces";
const { light, dark } = application.brand.tokens;

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

/** Open the app in a new context (a fresh profile) whose system prefers `colorScheme`. */
async function open(colorScheme: "light" | "dark" = "light") {
  const context = await browser.newContext({ colorScheme });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(server.url);
  await page.getByTestId("workbench").waitFor();
  return { page, errors, close: () => context.close() };
}

/** A token's value on the page's root, as the page computes it. */
const token = (page: Page, name: string) =>
  page.evaluate(
    (n) => getComputedStyle(document.documentElement).getPropertyValue(`--${n}`).trim(),
    name,
  );

/** The colour `var(--<name>)` resolves to, as a probe element's background. */
const resolved = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement("div");
    probe.style.background = `var(--${n})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  }, name);

const background = (page: Page, testId: string) =>
  page.getByTestId(testId).evaluate((el) => getComputedStyle(el).backgroundColor);

const isDark = (page: Page) =>
  page.evaluate(() => document.documentElement.classList.contains("dark"));

describe("the brand", () => {
  it("shows the application's name, logo and colours in light", async () => {
    const { page, errors, close } = await open("light");
    try {
      const brand = page.getByTestId("brand");
      await expect(brand.textContent()).resolves.toBe("Notes");
      await expect(brand.locator("img").getAttribute("src")).resolves.toBe(application.brand.logo);
      await expect(page.title()).resolves.toBe("Notes");
      await expect(isDark(page)).resolves.toBe(false);
      await expect(token(page, "primary")).resolves.toBe(light.primary);
      await expect(token(page, "background")).resolves.toBe(light.background);
      // The fragments' prebuilt CSS reads the brand's tokens: the notes view's button is primary.
      const button = page.getByTestId("notes-view").getByRole("button", { name: "Add note" });
      await expect(button.evaluate((el) => getComputedStyle(el).backgroundColor)).resolves.toBe(
        await resolved(page, "primary"),
      );
      await expect(
        page.evaluate(() => getComputedStyle(document.body).backgroundColor),
      ).resolves.toBe(await resolved(page, "background"));
      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  });

  it("shows the application's colours in dark when the system prefers dark", async () => {
    const { page, errors, close } = await open("dark");
    try {
      await expect(page.getByTestId("brand").textContent()).resolves.toBe("Notes");
      await expect(isDark(page)).resolves.toBe(true);
      await expect(token(page, "primary")).resolves.toBe(dark.primary);
      await expect(token(page, "background")).resolves.toBe(dark.background);
      await expect(token(page, "card")).resolves.toBe(dark.card);
      const card = await background(page, "notes-view");
      expect(card).toBe(await resolved(page, "card"));
      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  });

  it("follows the user's choice over the system's", async () => {
    const { page, errors, close } = await open("light");
    try {
      await page.evaluate(() => window.platform.appearance.setMode("dark"));
      await expect(isDark(page)).resolves.toBe(true);
      await expect(token(page, "primary")).resolves.toBe(dark.primary);
      await page.evaluate(() => window.platform.appearance.setMode("system"));
      await expect(token(page, "primary")).resolves.toBe(light.primary);
      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  });
});

describe("the baseline and the default layout", () => {
  it("a fresh profile installs and enables the baseline fragments and opens the default layout", async () => {
    const { page, errors, close } = await open();
    try {
      await page.getByTestId("notes-view").waitFor();
      const state = await page.evaluate(() => ({
        firstRun: window.platform.firstRun,
        opened: window.platform.workbench.opened(),
        enabled: [
          ...window.platform.kernel.slots.getSnapshot(window.platform.slots.enabled).keys(),
        ],
      }));
      expect(state.firstRun).toBe(true);
      expect(state.opened).toEqual(application.layout.open);
      expect(state.enabled).toEqual(expect.arrayContaining(application.baseline));
      await expect(page.locator(".dv-tab", { hasText: "Notes" }).count()).resolves.toBe(1);

      // The next run is not a first run: the profile restores what it recorded.
      await page.reload();
      await page.getByTestId("notes-view").waitFor();
      await expect(page.evaluate(() => window.platform.firstRun)).resolves.toBe(false);
      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  });

  it("drops the record of a fragment the application no longer serves, and boots", async () => {
    const { page, errors, close } = await open();
    try {
      await page.getByTestId("notes-view").waitFor();
      const key = `${application.id}:fragments/org.example.gone`;
      await page.evaluate((k) => {
        const record = { version: "1.0.0", archive: `sha256:${"0".repeat(64)}`, enabled: true };
        localStorage.setItem(k, JSON.stringify(record));
      }, key);
      await page.reload();
      await page.getByTestId("notes-view").waitFor();
      await expect(page.evaluate((k) => localStorage.getItem(k), key)).resolves.toBeNull();
      const installed = await page.evaluate(() => [
        ...window.platform.kernel.slots.getSnapshot(window.platform.slots.installed).keys(),
      ]);
      expect(installed).toEqual(expect.arrayContaining(application.baseline));
      expect(installed).not.toContain("org.example.gone");
      // The 404 of its manifest is the browser's own console error; nothing else failed.
      expect(errors.filter((e) => !e.includes("404"))).toEqual([]);
    } finally {
      await close();
    }
  });

  it("refuses to remove a baseline fragment, and disables it, for this run and the next", async () => {
    const { page, errors, close } = await open();
    try {
      await page.getByTestId("notes-view").waitFor();
      const refusal = await page.evaluate(
        (id) =>
          window.platform.kernel.remove(id).then(
            () => "removed",
            (error: Error) => error.message,
          ),
        NOTES,
      );
      expect(refusal).toMatch(/baseline/);
      await page.getByTestId("notes-view").waitFor();

      await page.evaluate((id) => window.platform.kernel.disable(id), NOTES);
      await page.getByTestId("notes-view").waitFor({ state: "detached" });

      // The profile keeps it installed and disabled.
      await page.reload();
      await page.getByTestId("workbench").waitFor();
      const after = await page.evaluate(() => ({
        installed: [
          ...window.platform.kernel.slots.getSnapshot(window.platform.slots.installed).keys(),
        ],
        enabled: [
          ...window.platform.kernel.slots.getSnapshot(window.platform.slots.enabled).keys(),
        ],
      }));
      expect(after.installed).toEqual(expect.arrayContaining([NOTES, SURFACES]));
      expect(after.enabled).not.toContain(NOTES);
      expect(after.enabled).toContain(SURFACES);
      await expect(page.getByTestId("notes-view").count()).resolves.toBe(0);

      await page.evaluate((id) => window.platform.kernel.enable(id), NOTES);
      await page.evaluate((id) => window.platform.workbench.open(`${id}/notes`), NOTES);
      await page.getByTestId("notes-view").waitFor();
      expect(errors).toEqual([]);
    } finally {
      await close();
    }
  });
});
