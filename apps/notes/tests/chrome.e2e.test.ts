// Seam 2 (spec statewalker/statewalker-root#215, ticket statewalker/statewalker-root#254): the
// workbench chrome in Chromium. The notes fragment declares its `new-note` command, a menu bar
// menu, a view context menu and title menu, a keybinding, a dialog, a notification, a status bar
// item and an activity bar entry statically; the command asks the user through the dialog and
// reports through the notification, and the answers reach it.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, chromium, type Page, type Route } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type StaticServer, serveStatic } from "../scripts/static-server.mjs";

const DIST = resolve(import.meta.dirname, "..", "dist");
const NOTES = "org.statewalker.notes";
const BUNDLE = `**/archives/${NOTES}/client/index.js`;

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
  page: Page;
  errors: string[];
}

/** Open the app; `beforeGoto` may route requests first. */
async function open(beforeGoto?: (page: Page) => Promise<void>): Promise<Opened> {
  const page = await browser.newPage();
  page.setDefaultTimeout(10_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await beforeGoto?.(page);
  await page.goto(server.url);
  await page.getByTestId("workbench").waitFor();
  return { page, errors };
}

async function withPage(
  body: (opened: Opened) => Promise<void>,
  beforeGoto?: (page: Page) => Promise<void>,
) {
  const opened = await open(beforeGoto);
  try {
    await body(opened);
    expect(opened.errors).toEqual([]);
  } finally {
    await opened.page.close();
  }
}

const notesView = (page: Page) => page.getByTestId("notes-view");
const newNoteDialog = (page: Page) => page.getByRole("dialog", { name: "New note" });
const menubar = (page: Page) => page.getByRole("menubar");

/** Answer notes' "New note" dialog with `text`, and wait for the note in the view. */
async function answerNewNote(page: Page, text: string) {
  const dialog = newNoteDialog(page);
  await dialog.waitFor();
  await dialog.getByRole("textbox", { name: "Note" }).fill(text);
  await dialog.getByRole("button", { name: "Add" }).click();
  await dialog.waitFor({ state: "detached" });
  await notesView(page).getByRole("listitem").filter({ hasText: text }).waitFor();
}

describe("the workbench chrome runs notes' command", () => {
  it("from the menu bar", async () => {
    await withPage(async ({ page }) => {
      await notesView(page).waitFor();
      await menubar(page).getByRole("menuitem", { name: "Notes" }).click();
      await page.getByRole("menuitem", { name: /New note/ }).click();
      await answerNewNote(page, "From the menu bar");
    });
  });

  it("from the view's context menu and its tab's menu", async () => {
    await withPage(async ({ page }) => {
      await notesView(page).click({ button: "right" });
      await page
        .getByRole("menu")
        .getByRole("menuitem", { name: /New note/ })
        .click();
      await answerNewNote(page, "From the context menu");

      await page.getByRole("button", { name: "View actions" }).click();
      await page
        .getByRole("menu")
        .getByRole("menuitem", { name: /New note/ })
        .click();
      await answerNewNote(page, "From the tab menu");
    });
  });

  it("from the command palette, which lists every command it can run, by its label", async () => {
    await withPage(async ({ page }) => {
      await notesView(page).waitFor();
      await page.keyboard.press("Control+Shift+P");
      const palette = page.getByRole("dialog", { name: "Command Palette" });
      await palette.waitFor();
      // add-note needs a text, which the palette cannot give: it is not offered.
      await expect(palette.getByRole("option").allInnerTexts()).resolves.toEqual([
        expect.stringMatching(/^New note…\s*Ctrl\+Alt\+N$/),
      ]);
      await palette.getByRole("combobox").fill("new");
      await page.keyboard.press("Enter");
      await palette.waitFor({ state: "detached" });
      await answerNewNote(page, "From the palette");
    });
  });

  it("from its keybinding", async () => {
    await withPage(async ({ page }) => {
      await notesView(page).waitFor();
      await page.keyboard.press("Control+Alt+KeyN");
      await answerNewNote(page, "From the keyboard");
    });
  });

  it("but not while typing: a text field keeps Ctrl+Alt+N, and AltGr keys are never taken", async () => {
    await withPage(async ({ page }) => {
      const field = notesView(page).getByPlaceholder("Write a note");
      await field.click();
      await field.pressSequentially("ab");
      await page.keyboard.press("Control+Alt+KeyN");
      await field.pressSequentially("c");
      await expect(field.inputValue()).resolves.toMatch(/^ab.*c$/);
      await expect(newNoteDialog(page).count()).resolves.toBe(0);

      // AltGr+N as Chromium on Windows reports it (a Polish ń): ctrl, alt and AltGraph's state.
      await field.blur();
      const altGr = (altGraph: boolean) =>
        page.evaluate((modifierAltGraph) => {
          document.body.dispatchEvent(
            new KeyboardEvent("keydown", {
              key: modifierAltGraph ? "ń" : "n",
              code: "KeyN",
              ctrlKey: true,
              altKey: true,
              modifierAltGraph,
              bubbles: true,
              cancelable: true,
            } as KeyboardEventInit),
          );
        }, altGraph);
      await altGr(true);
      await page.waitForTimeout(300);
      await expect(newNoteDialog(page).count()).resolves.toBe(0);
      // The same event without AltGraph is the binding.
      await altGr(false);
      await newNoteDialog(page).waitFor();
    });
  });

  it("from the status bar and the activity bar", async () => {
    await withPage(async ({ page }) => {
      await page.getByTestId("statusbar").getByRole("button", { name: "New note" }).click();
      await answerNewNote(page, "From the status bar");

      // The activity bar's Notes entry reopens the view once it is closed.
      await page.evaluate((id) => window.platform.workbench.close(`${id}/notes`), NOTES);
      await notesView(page).waitFor({ state: "detached" });
      await page.getByTestId("activitybar").getByRole("button", { name: "Notes" }).click();
      await notesView(page).waitFor();
    });
  });
});

describe("the chrome's context", () => {
  it("shows a status item whose `when` names the active view only while that view is active", async () => {
    await withPage(async ({ page }) => {
      const item = page.getByTestId("statusbar").getByText("Notes view");
      await notesView(page).waitFor();
      await item.waitFor();
      await page.evaluate((id) => window.platform.workbench.close(`${id}/notes`), NOTES);
      await item.waitFor({ state: "detached" });
      await page.getByTestId("activitybar").getByRole("button", { name: "Notes" }).click();
      await item.waitFor();
    });
  });
});

describe("dialogs and notifications raised by a fragment", () => {
  it("return the user's answers to the fragment", async () => {
    await withPage(async ({ page }) => {
      await notesView(page).waitFor();
      // The dialog's answer: dismissed, nothing is added.
      await page.keyboard.press("Control+Alt+KeyN");
      await newNoteDialog(page).getByRole("textbox", { name: "Note" }).fill("Never mind");
      await newNoteDialog(page).getByRole("button", { name: "Cancel" }).click();
      await newNoteDialog(page).waitFor({ state: "detached" });
      await page.keyboard.press("Control+Alt+KeyN");
      await newNoteDialog(page).waitFor();
      await page.keyboard.press("Escape");
      await newNoteDialog(page).waitFor({ state: "detached" });
      await expect(notesView(page).getByRole("listitem").count()).resolves.toBe(0);

      // Answered with Add (Enter, the primary button): the note is added, and a notification says so.
      await page.keyboard.press("Control+Alt+KeyN");
      await newNoteDialog(page).getByRole("textbox", { name: "Note" }).fill("Water the plants");
      await page.keyboard.press("Enter");
      await notesView(page).getByRole("listitem").filter({ hasText: "Water the plants" }).waitFor();
      const toast = page.getByTestId("notification").filter({ hasText: "Note added" });
      await toast.waitFor();
      await expect(toast.innerText()).resolves.toContain("Water the plants");

      // The notification's answer: Undo removes the note again.
      await toast.getByRole("button", { name: "Undo" }).click();
      await toast.waitFor({ state: "detached" });
      await expect(notesView(page).getByRole("listitem").count()).resolves.toBe(0);
    });
  });

  it("look the same for every fragment: a failing command raises the workbench's own notification", async () => {
    await withPage(async ({ page }) => {
      await notesView(page).waitFor();
      // add-note run as the chrome runs commands (no input) fails, and the workbench says so.
      await page.evaluate((id) => window.platform.workbench.execute(`${id}/add-note`), NOTES);
      const toast = page.getByTestId("notification").filter({ hasText: "Add a note failed" });
      await toast.waitFor();
      // Same markup as notes' own notification: one component renders every fragment's.
      await expect(toast.getAttribute("data-severity")).resolves.toBe("error");
      await expect(toast.getAttribute("data-fragment")).resolves.toBe("system.workbench");
    });
  });
});

describe("static contributions", () => {
  it("appear before the contributor's code loads", async () => {
    let held: Route | undefined;
    await withPage(
      async ({ page }) => {
        // The bundle is held: the view shows its loading state, the chrome is already there.
        await page.getByText("Loading…").waitFor();
        expect(held).toBeDefined();
        await menubar(page).getByRole("menuitem", { name: "Notes" }).click();
        const item = page.getByRole("menuitem", { name: /New note/ });
        await item.waitFor();
        await expect(item.innerText()).resolves.toMatch(/Ctrl\+Alt\+N/);
        await page.keyboard.press("Escape");
        await page.getByTestId("statusbar").getByRole("button", { name: "New note" }).waitFor();
        await page.getByTestId("activitybar").getByRole("button", { name: "Notes" }).waitFor();
        const keys = await page.evaluate(() =>
          window.platform.workbench.keybindings().map((k) => `${k.key} ${k.command}`),
        );
        expect(keys).toEqual([`ctrl+alt+n ${NOTES}/new-note`]);

        // The keybinding runs the command, whose handler is in the held bundle: once it arrives,
        // the dialog opens.
        await page.keyboard.press("Control+Alt+KeyN");
        await expect(newNoteDialog(page).count()).resolves.toBe(0);
        await held?.continue();
        await answerNewNote(page, "After the bundle");
      },
      async (page) => {
        await page.route(BUNDLE, (route) => {
          held = route;
        });
      },
    );
  });

  it("disappear when the contributor is disabled", async () => {
    await withPage(async ({ page }) => {
      await notesView(page).waitFor();
      await menubar(page).getByRole("menuitem", { name: "Notes" }).waitFor();
      await page.evaluate((id) => window.platform.kernel.disable(id), NOTES);
      await notesView(page).waitFor({ state: "detached" });

      await expect(menubar(page).getByRole("menuitem", { name: "Notes" }).count()).resolves.toBe(0);
      await expect(page.getByTestId("statusbar").getByRole("button").count()).resolves.toBe(0);
      // system.settings' own entry stays; the fragment's is gone.
      await expect(
        page.getByTestId("activitybar").getByRole("button", { name: "Notes" }).count(),
      ).resolves.toBe(0);
      await expect(page.evaluate(() => window.platform.workbench.keybindings())).resolves.toEqual(
        [],
      );
      await page.keyboard.press("Control+Alt+KeyN");
      await page.keyboard.press("Control+Shift+P");
      const palette = page.getByRole("dialog", { name: "Command Palette" });
      await palette.waitFor();
      await expect(palette.getByRole("option").count()).resolves.toBe(0);
      await expect(newNoteDialog(page).count()).resolves.toBe(0);
    });
  });
});
