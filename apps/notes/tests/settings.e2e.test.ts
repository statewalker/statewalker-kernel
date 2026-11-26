// Seam 2 (spec statewalker/statewalker-root#215, user stories 10, 17, 20 and 30): system.settings
// through apps/notes in Chromium. The settings view lists every enabled fragment's page, rendered
// from the schema the fragment declares; a value changed there reaches the fragment (the notes
// view re-sorts, hides its Copy buttons), is kept in the profile over a reload, leaves the view
// with its disabled fragment, and survives a removal unless the fragment is removed with data.
// Each test opens a new browser context, so it starts from a fresh profile. The app is `dist/`.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import application from "../application.json" with { type: "json" };
import { type StaticServer, serveStatic } from "../scripts/static-server.mjs";

const DIST = resolve(import.meta.dirname, "..", "dist");
const NOTES = "org.statewalker.notes";
const EXTRA = "org.example.extra";
const NOTES_KEY = `${application.id}:settings/${NOTES}`;
const EXTRA_KEY = `${application.id}:settings/${EXTRA}`;

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

/** Run `body` on the app in a new context (a fresh profile); fails on any page error. */
async function withPage(body: (page: Page) => Promise<void>) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // A fragment without a stylesheet (the test's own) 404s its index.css, harmlessly.
    if (message.type() === "error" && !message.text().includes("404")) errors.push(message.text());
  });
  try {
    await page.goto(server.url);
    await page.getByTestId("workbench").waitFor();
    await body(page);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
}

const notesView = (page: Page) => page.getByTestId("notes-view");
const settingsView = (page: Page) => page.getByTestId("settings-view");
const settingsPage = (page: Page, fragment: string) =>
  settingsView(page).locator(`[data-testid="settings-page"][data-fragment="${fragment}"]`);
const notes = (page: Page) => notesView(page).locator("li > span").allInnerTexts();

async function addNotes(page: Page, ...texts: string[]) {
  for (const text of texts) {
    await page.evaluate(
      ([id, t]) => window.platform.commands.call(id as string, { text: t }),
      [`${NOTES}/add-note`, text],
    );
  }
}

/** Open the settings view from the activity bar. */
async function openSettings(page: Page) {
  await page.getByTestId("activitybar").getByRole("button", { name: "Settings" }).click();
  await settingsView(page).waitFor();
}

/** Pick `option` in the setting labelled `label` of the notes page (a shadcn Select). */
async function choose(page: Page, label: string, option: string) {
  await settingsPage(page, NOTES).getByLabel(label).click();
  await page.getByRole("option", { name: option }).click();
}

/** Switch the notes view's tab forward (it shares the centre with the settings view). */
async function showNotes(page: Page) {
  await page.evaluate((id) => window.platform.workbench.setActive(id), `${NOTES}/notes`);
  await notesView(page).waitFor();
}

describe("settings", () => {
  it("changes a notes setting in the settings view, and the notes view follows", async () => {
    await withPage(async (page) => {
      await notesView(page).waitFor();
      await addNotes(page, "pears", "apples", "figs");
      await expect(notes(page)).resolves.toEqual(["pears", "apples", "figs"]);
      await expect(notesView(page).getByRole("button", { name: "Copy" }).count()).resolves.toBe(3);

      await openSettings(page);
      const page_ = settingsPage(page, NOTES);
      await expect(page_.getByRole("heading").first().innerText()).resolves.toBe("Notes");
      // The defaults, from the schema the fragment declares.
      await expect(page_.getByLabel("Sort notes by").innerText()).resolves.toBe("Order added");
      await expect(page_.getByLabel("Show Copy buttons").isChecked()).resolves.toBe(true);

      await choose(page, "Sort notes by", "Alphabetical");
      await page_.getByLabel("Show Copy buttons").uncheck();
      await expect(page_.getByLabel("Sort notes by").innerText()).resolves.toBe("Alphabetical");

      await showNotes(page);
      await expect(notes(page)).resolves.toEqual(["apples", "figs", "pears"]);
      await expect(notesView(page).getByRole("button", { name: "Copy" }).count()).resolves.toBe(0);
      // Kept in the profile, under the fragment's own key (a storage format: version 1).
      await expect(
        page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), NOTES_KEY),
      ).resolves.toEqual({ version: 1, values: { sort: "alphabetical", copyButtons: false } });
    });
  });

  it("keeps the values over a reload, and resets them to the defaults", async () => {
    await withPage(async (page) => {
      await openSettings(page);
      await choose(page, "Sort notes by", "Alphabetical");
      await page.reload();
      await page.getByTestId("workbench").waitFor();
      await addNotes(page, "b", "a");
      await showNotes(page);
      await expect(notes(page)).resolves.toEqual(["a", "b"]);

      await openSettings(page);
      const page_ = settingsPage(page, NOTES);
      await expect(page_.getByLabel("Sort notes by").innerText()).resolves.toBe("Alphabetical");
      await page_.getByRole("button", { name: "Reset to defaults" }).click();
      await expect(page_.getByLabel("Sort notes by").innerText()).resolves.toBe("Order added");
      await showNotes(page);
      await expect(notes(page)).resolves.toEqual(["b", "a"]);
      await expect(page.evaluate((key) => localStorage.getItem(key), NOTES_KEY)).resolves.toBe(
        null,
      );
    });
  });

  it("drops a disabled fragment's page, and brings it back with its values", async () => {
    await withPage(async (page) => {
      await openSettings(page);
      await choose(page, "Sort notes by", "Alphabetical");
      await page.evaluate((id) => window.platform.kernel.disable(id), NOTES);
      await settingsPage(page, NOTES).waitFor({ state: "detached" });
      await expect(settingsView(page).getByText("No fragment has settings.").count()).resolves.toBe(
        1,
      );
      await page.evaluate((id) => window.platform.kernel.enable(id), NOTES);
      await expect(settingsPage(page, NOTES).getByLabel("Sort notes by").innerText()).resolves.toBe(
        "Alphabetical",
      );
    });
  });

  it("keeps a removed fragment's values unless it is removed with data", async () => {
    await withPage(async (page) => {
      await openSettings(page);
      await choose(page, "Sort notes by", "Alphabetical");
      // A fragment installed at run time with a settings page (removable: not in the baseline).
      const install = () =>
        page.evaluate(async (id) => {
          const files = {
            "fragment.jsonc": JSON.stringify({
              $schema: "fragment.v1.schema.json",
              id,
              version: "1.0.0",
              engines: { platform: "^0.1.0" },
              aspects: { client: {} },
            }),
            "fragment.client.jsonc": JSON.stringify({
              $schema: "fragment-aspect.v1.schema.json",
              extensions: [
                {
                  point: "settings",
                  data: {
                    title: "Extra",
                    schema: {
                      type: "object",
                      properties: { motto: { type: "string", title: "Motto", maxLength: 20 } },
                    },
                  },
                },
              ],
            }),
          };
          const { kernel } = window.platform;
          for (const f of await kernel.install([files])) await kernel.enable(f.id);
        }, EXTRA);
      // The shell activates its client aspect once it resolves; a removal waits for that.
      const active = () =>
        page.waitForFunction(
          (id) => window.platform.kernel.slots.getSnapshot(window.platform.slots.active).has(id),
          EXTRA,
        );
      await install();
      await active();
      const extra = settingsPage(page, EXTRA);
      await extra.getByLabel("Motto").fill("carpe diem");
      // A value the schema refuses is shown with the reason, not stored.
      await extra.getByLabel("Motto").fill("far too long for the schema");
      await extra.getByRole("alert").waitFor();
      const stored = () =>
        page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), EXTRA_KEY);
      await expect(stored()).resolves.toEqual({ version: 1, values: { motto: "carpe diem" } });

      await page.evaluate((id) => window.platform.kernel.remove(id), EXTRA);
      await extra.waitFor({ state: "detached" });
      await expect(stored()).resolves.toEqual({ version: 1, values: { motto: "carpe diem" } });
      await install();
      await active();
      await expect(extra.getByLabel("Motto").inputValue()).resolves.toBe("carpe diem");

      await page.evaluate((id) => window.platform.kernel.remove(id, { withData: true }), EXTRA);
      await extra.waitFor({ state: "detached" });
      await expect(stored()).resolves.toBeNull();
      // Another fragment's values stay.
      await expect(
        page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), NOTES_KEY),
      ).resolves.toEqual({ version: 1, values: { sort: "alphabetical" } });
    });
  });

  it("shows the labels in the interface language, switched live", async () => {
    await withPage(async (page) => {
      await openSettings(page);
      await choose(page, "Sort notes by", "Alphabetical");
      await page.evaluate(() => window.platform.l10n.setLocale("fr"));
      const page_ = settingsPage(page, NOTES);
      // The notes fragment's own French texts: its page, its settings and their choices (once the
      // view has rendered the new language: the switch is live, not synchronous).
      await page_.getByRole("heading", { name: "Bloc-notes", exact: true }).waitFor();
      await expect(page_.getByRole("heading").first().innerText()).resolves.toBe("Bloc-notes");
      await expect(page_.getByLabel("Trier les notes par").innerText()).resolves.toBe(
        "Ordre alphabétique",
      );
      await page_.getByLabel("Afficher les boutons Copier").waitFor();
      // system.settings' own: the view's texts, its tab and its activity bar entry.
      await page_.getByRole("button", { name: "Rétablir les valeurs par défaut" }).waitFor();
      await page.getByTestId("activitybar").getByRole("button", { name: "Paramètres" }).waitFor();
      await settingsPage(page, NOTES).getByLabel("Trier les notes par").click();
      await page.getByRole("option", { name: "Ordre d'ajout" }).click();
      await expect(page_.getByLabel("Trier les notes par").innerText()).resolves.toBe(
        "Ordre d'ajout",
      );
      // The values are not texts: stored as declared.
      await expect(
        page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), NOTES_KEY),
      ).resolves.toEqual({ version: 1, values: { sort: "added" } });
      await page.evaluate(() => window.platform.l10n.setLocale("en"));
      await expect(page_.getByLabel("Sort notes by").innerText()).resolves.toBe("Order added");
    });
  });
});
