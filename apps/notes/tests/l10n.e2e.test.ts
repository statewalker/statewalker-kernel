// Seam 2 (spec statewalker/statewalker-root#215, ticket statewalker/statewalker-root#256): the
// interface language in Chromium. The notes fragment declares English and French bundles on
// system.l10n's `l10n` point; the language picker switches English → French → English without a
// reload, and the menu bar, the notes view, its tab, the status bar, the palette and the dialog
// follow. The French bundle leaves `view.count` out: French shows the default language's text.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type StaticServer, serveStatic } from "../scripts/static-server.mjs";

const DIST = resolve(import.meta.dirname, "..", "dist");

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

/** Open the app in a fresh English context; `body` runs, then no page error may be left. */
async function withPage(
  body: (page: Page) => Promise<void>,
  viewport: { width: number; height: number } = { width: 1280, height: 800 },
) {
  const context = await browser.newContext({ locale: "en-US", viewport });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    await page.goto(server.url);
    await page.getByTestId("notes-view").waitFor();
    await body(page);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
}

const menubar = (page: Page) => page.getByRole("menubar");
const view = (page: Page) => page.getByTestId("notes-view");
const picker = (page: Page) => page.getByTestId("language-picker");

/** The palette's entries, opened and closed again. */
async function paletteEntries(page: Page): Promise<string[]> {
  await page.keyboard.press("Control+Shift+P");
  const palette = page.getByRole("dialog", { name: "Command Palette" });
  await palette.waitFor();
  const entries = await palette.getByRole("option").allInnerTexts();
  await page.keyboard.press("Escape");
  await palette.waitFor({ state: "detached" });
  return entries;
}

/** The menu bar's Notes menu's entries, opened and closed again. */
async function notesMenu(page: Page, title: string): Promise<string[]> {
  await menubar(page).getByRole("menuitem", { name: title, exact: true }).click();
  const menu = page.getByRole("menu");
  await menu.waitFor();
  const entries = await menu.getByRole("menuitem").allInnerTexts();
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "detached" });
  return entries;
}

/** What the page shows in the language at hand. */
async function shown(page: Page) {
  return {
    picker: await page
      .getByLabel(/^(Language|Langue)$/)
      .first()
      .getAttribute("aria-label"),
    menubar: await menubar(page).getByRole("menuitem").allInnerTexts(),
    tab: await page.locator(".dv-tab").first().innerText(),
    title: await page.getByTestId("notes-title").innerText(),
    button: await view(page).getByRole("button").first().innerText(),
    placeholder: await view(page).getByRole("textbox").getAttribute("placeholder"),
    count: await page.getByTestId("notes-count").innerText(),
    status: await page.getByTestId("statusbar").locator("button").allInnerTexts(),
    lang: await view(page).getAttribute("lang"),
  };
}

const ENGLISH = {
  picker: "Language",
  menubar: ["Notes"],
  tab: "Notes",
  title: "Notes",
  button: "Add note",
  placeholder: "Write a note",
  count: "Notes: 0",
  status: ["New note"],
  lang: "en-US",
};

describe("the interface language", () => {
  it("switches English → French → English without a reload", async () => {
    await withPage(async (page) => {
      await page.evaluate(() => {
        (window as unknown as { unreloaded: boolean }).unreloaded = true;
      });
      await expect(shown(page)).resolves.toEqual(ENGLISH);
      await expect(notesMenu(page, "Notes")).resolves.toEqual([
        expect.stringMatching(/^New note…\s*Ctrl\+Alt\+N$/),
      ]);
      await expect(paletteEntries(page)).resolves.toEqual([
        expect.stringMatching(/^New note…\s*Ctrl\+Alt\+N$/),
      ]);

      await picker(page).selectOption("fr");
      await menubar(page).getByRole("menuitem", { name: "Bloc-notes" }).waitFor();
      await expect(shown(page)).resolves.toEqual({
        picker: "Langue",
        menubar: ["Bloc-notes"],
        tab: "Bloc-notes",
        title: "Bloc-notes",
        button: "Ajouter la note",
        placeholder: "Écrire une note",
        // No French text for the count: the default language's (English) bundle.
        count: "Notes: 0",
        status: ["Nouvelle note"],
        lang: "fr",
      });
      await expect(notesMenu(page, "Bloc-notes")).resolves.toEqual([
        expect.stringMatching(/^Nouvelle note…\s*Ctrl\+Alt\+N$/),
      ]);
      await expect(paletteEntries(page)).resolves.toEqual([
        expect.stringMatching(/^Nouvelle note…\s*Ctrl\+Alt\+N$/),
      ]);
      await page.keyboard.press("Control+Shift+P");
      await expect(page.getByPlaceholder("Saisir une commande…").count()).resolves.toBe(1);
      await page.keyboard.press("Escape");

      // The dialog and the notification the command raises are French too.
      await page.keyboard.press("Control+Alt+KeyN");
      const dialog = page.getByRole("dialog", { name: "Nouvelle note" });
      await dialog.waitFor();
      await dialog.getByRole("textbox", { name: "Note" }).fill("Du lait");
      await dialog.getByRole("button", { name: "Ajouter" }).click();
      await page.getByText("Note ajoutée").waitFor();
      await expect(page.getByTestId("notes-count").innerText()).resolves.toBe("Notes: 1");

      await picker(page).selectOption("en");
      await menubar(page).getByRole("menuitem", { name: "Notes" }).waitFor();
      await expect(shown(page)).resolves.toEqual({ ...ENGLISH, count: "Notes: 1", lang: "en" });
      await expect(paletteEntries(page)).resolves.toEqual([
        expect.stringMatching(/^New note…\s*Ctrl\+Alt\+N$/),
      ]);
      // The note written in French is still there: the page was never reloaded.
      await expect(view(page).getByRole("listitem").allInnerTexts()).resolves.toEqual([
        expect.stringMatching(/^Du lait/),
      ]);
      await expect(
        page.evaluate(() => (window as unknown as { unreloaded?: boolean }).unreloaded),
      ).resolves.toBe(true);
    });
  });

  it("falls back to the default language for a text a language lacks", async () => {
    await withPage(async (page) => {
      const { l10n } = await page.evaluate(() => ({
        l10n: window.platform.l10n.locales(),
      }));
      expect(l10n).toEqual(["en", "fr"]);
      await picker(page).selectOption("fr");
      await page.getByText("Bloc-notes").first().waitFor();
      // German has no bundle at all: every text is the default language's.
      await page.evaluate(() => window.platform.l10n.setLocale("de"));
      await menubar(page).getByRole("menuitem", { name: "Notes" }).waitFor();
      await expect(shown(page)).resolves.toEqual({ ...ENGLISH, picker: "Language", lang: "de" });
    });
  });

  it("reaches a phone's tab bar and More menu", async () => {
    await withPage(
      async (page) => {
        const tabBar = page.getByRole("navigation", { name: "Tab bar" });
        await expect(tabBar.getByRole("tab").allInnerTexts()).resolves.toEqual(["Notes"]);
        await picker(page).selectOption("fr");
        const barre = page.getByRole("navigation", { name: "Barre d'onglets" });
        await barre.waitFor();
        await expect(barre.getByRole("tab").allInnerTexts()).resolves.toEqual(["Bloc-notes"]);
        await page.getByRole("button", { name: "Plus" }).click();
        const more = page.getByRole("menu");
        // The menu bar's Notes menu, by its French title; the surfaces view, which has no
        // French text, by its inline title.
        await more.getByRole("menuitem", { name: "Bloc-notes" }).waitFor();
        await more.getByRole("menuitem", { name: "Surfaces" }).waitFor();
        await expect(more.getByText("Ouvrir", { exact: true }).count()).resolves.toBe(1);
      },
      { width: 390, height: 844 },
    );
  });

  it("reaches a tablet's zone drawers", async () => {
    await withPage(
      async (page) => {
        await page.getByRole("button", { name: "Right zone" }).waitFor();
        await picker(page).selectOption("fr");
        const right = page.getByRole("button", { name: "Zone droite" });
        await expect(right.innerText()).resolves.toBe("Droite (0)");
        await right.click();
        const drawer = page.getByRole("region", { name: "Zone droite" });
        await drawer.getByText("Aucune vue ici.").waitFor();
        await drawer.getByRole("button", { name: "Fermer le tiroir" }).click();
        await drawer.waitFor({ state: "detached" });
      },
      { width: 820, height: 1180 },
    );
  });
});
