// Seam 2 (statewalker/statewalker-root#261, its acceptance criteria): notes-export installed live in
// apps/notes, in the launch configuration `browser` (its server half on CellB in the page's origin).
// The user installs it from the app's catalog through the consent screen; its action shows in the
// notes view (the notes fragment's `actions` point), with its command, menu entry and Exports view.
// Removed, all of them go and the rest stays; its DO data is kept, and found again on a reinstall,
// unless it is removed with data. One whose server half cannot load is shown failed and is retried,
// while notes keeps working. Each test opens a new browser context: a fresh profile and OPFS.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Launched, launch } from "../scripts/launch.mjs";

const DIST = resolve(import.meta.dirname, "..", "dist");
const NOTES = "org.statewalker.notes";
const EXPORT = "org.statewalker.notes-export";

let browser: Browser;
let app: Launched;
beforeAll(async () => {
  if (!existsSync(join(DIST, "index.html"))) {
    throw new Error(`no build at ${DIST}: run \`pnpm run build\` in apps/notes first`);
  }
  browser = await chromium.launch();
  app = await launch("browser");
}, 60_000);
afterAll(async () => {
  await browser?.close();
  await app?.close();
});

/** Run `body` on the app in a new context, its server halves started; fails on any page error. */
async function withPage(
  body: (page: Page, context: BrowserContext) => Promise<void>,
  expected: RegExp[] = [],
  before?: (context: BrowserContext) => Promise<void>,
) {
  const context = await browser.newContext();
  await before?.(context);
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    // A fragment without a stylesheet 404s its index.css, harmlessly; a test may expect others.
    if (message.type() === "error" && !text.includes("404") && !expected.some((e) => e.test(text)))
      errors.push(text);
  });
  try {
    await page.goto(app.url);
    await page.getByTestId("workbench").waitFor();
    if (!before) await page.waitForFunction(() => window.fragmentServers !== undefined);
    await body(page, context);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
}

const manager = (page: Page) => page.getByTestId("fragments-view");
const consent = (page: Page) => page.getByTestId("consent-dialog");
const entry = (page: Page, id: string) =>
  manager(page).locator(`[data-testid="fragment-entry"][data-fragment="${id}"]`);
const activity = (page: Page, name: string) =>
  page.getByTestId("activitybar").getByRole("button", { name, exact: true });
const notesView = (page: Page) => page.getByTestId("notes-view");
const exportButton = (page: Page) =>
  notesView(page).getByTestId("notes-actions").getByRole("button", { name: "Export" });
const commandIds = (page: Page) =>
  page.evaluate(() => window.platform.commands.list().map((c) => c.id));
const stateOf = (page: Page, id: string) =>
  page.evaluate(
    (f) =>
      document
        .querySelector(`[data-testid="fragment-entry"][data-fragment="${f}"]`)
        ?.getAttribute("data-state") ?? null,
    id,
  );

async function show(page: Page, view: string) {
  await page.evaluate((v) => window.platform.workbench.setActive(v), view);
}

async function addNotes(page: Page, ...texts: string[]) {
  for (const text of texts)
    await page.evaluate(
      ([id, t]) => window.platform.commands.call(id as string, { text: t }),
      [`${NOTES}/add-note`, text],
    );
}

/** Install notes-export from the catalog through the consent screen. */
async function installExport(page: Page) {
  await activity(page, "Fragments").click();
  const offer = manager(page).locator(
    `[data-testid="fragment-available"][data-fragment="${EXPORT}"]`,
  );
  await offer.getByRole("button", { name: "Install…" }).click();
  await consent(page).getByRole("button", { name: "Install" }).click();
  await consent(page).waitFor({ state: "detached" });
}

async function remove(page: Page, withData: boolean) {
  await show(page, "system.fragments/fragments");
  await entry(page, EXPORT)
    .getByRole("button", { name: withData ? "Remove with data" : "Remove", exact: true })
    .click();
  await page
    .getByTestId("fragments-confirm")
    .getByRole("button", { name: withData ? "Remove and delete its data" : "Remove" })
    .click();
  await entry(page, EXPORT).waitFor({ state: "detached" });
}

/** The exports the Exports view lists, its count line. */
async function exportsShown(page: Page) {
  await activity(page, "Exports").click();
  const view = page.getByTestId("exports-view");
  await view.waitFor();
  // The count shows once the view has read the DO.
  const count = await view.getByTestId("exports-count").innerText();
  // Read from the DO, not left from before: the read raised no error.
  expect(await view.getByRole("alert").count()).toBe(0);
  return count;
}

describe("notes-export, installed live", () => {
  it("shows everything it asks for before the user consents; declining installs nothing", async () => {
    await withPage(async (page) => {
      await activity(page, "Fragments").click();
      const offer = manager(page).locator(
        `[data-testid="fragment-available"][data-fragment="${EXPORT}"]`,
      );
      await offer.getByRole("button", { name: "Install…" }).click();
      const dialog = consent(page);
      await expect(dialog.getByTestId("consent-source").innerText()).resolves.toBe(
        `${app.url}archives/${EXPORT}/`,
      );
      await expect(dialog.getByTestId("consent-content-hash").innerText()).resolves.toMatch(
        /^sha256:[0-9a-f]{64}$/,
      );
      await expect(dialog.getByTestId("consent-requires").innerText()).resolves.toBe(
        `${NOTES} ^0.1.0: installed 0.1.0`,
      );
      await expect(dialog.getByTestId("consent-server-half").innerText()).resolves.toBe("yes");
      await expect(dialog.getByTestId("consent-exposures").innerText()).resolves.toBe(
        `${EXPORT}/export-notes (agent)`,
      );
      await expect(dialog.getByTestId("consent-bindings").innerText()).resolves.toBe("none");
      await expect(dialog.getByTestId("consent-agent-plugins").innerText()).resolves.toBe("none");
      await expect(dialog.getByTestId("consent-secrets").innerText()).resolves.toBe("none");
      await dialog.getByRole("button", { name: "Decline" }).click();
      await dialog.waitFor({ state: "detached" });
      await expect(
        page.evaluate(
          (id) => window.platform.kernel.slots.getSnapshot(window.platform.slots.installed).has(id),
          EXPORT,
        ),
      ).resolves.toBe(false);
      await expect(commandIds(page)).resolves.not.toContain(`${EXPORT}/export-notes`);
    });
  });

  it("brings its action, command, menu entry and view; removed, they go and notes stays", async () => {
    await withPage(async (page) => {
      await notesView(page).waitFor();
      await addNotes(page, "milk", "bread");
      await installExport(page);
      await page.waitForFunction(
        (id) => document.querySelector(`[data-fragment="${id}"][data-state="active"]`) !== null,
        EXPORT,
      );

      // Its action in the notes view, on the notes fragment's `actions` point.
      await show(page, `${NOTES}/notes`);
      await exportButton(page).click();
      await expect(notesView(page).getByTestId("notes-action-result").innerText()).resolves.toBe(
        "Exported 2 notes (export 1)",
      );
      // Its command (also from the notes menu), and its view with the kept exports.
      await expect(commandIds(page)).resolves.toContain(`${EXPORT}/export-notes`);
      await page.getByRole("menubar").getByRole("menuitem", { name: "Notes" }).click();
      await page.getByRole("menuitem", { name: "Export the notes" }).click();
      await expect(exportsShown(page)).resolves.toBe("2 exports");

      await remove(page, false);
      await expect(commandIds(page)).resolves.not.toContain(`${EXPORT}/export-notes`);
      await activity(page, "Exports").waitFor({ state: "detached" });
      await show(page, `${NOTES}/notes`);
      await notesView(page).getByTestId("notes-actions").waitFor({ state: "detached" });
      await page.getByRole("menubar").getByRole("menuitem", { name: "Notes" }).click();
      await expect(page.getByRole("menuitem", { name: "Export the notes" }).count()).resolves.toBe(
        0,
      );
      await page.keyboard.press("Escape");
      // The rest is unchanged: notes, its commands, and the other fragments.
      await expect(page.getByTestId("notes-count").innerText()).resolves.toContain("2");
      await addNotes(page, "eggs");
      await expect(page.getByTestId("notes-count").innerText()).resolves.toContain("3");
      await show(page, "system.fragments/fragments");
      await expect(stateOf(page, NOTES)).resolves.toBe("active");
      await expect(stateOf(page, "org.statewalker.surfaces")).resolves.toBe("active");
    });
  });

  it("keeps its DO data over a removal, and deletes it with 'remove with data'", async () => {
    await withPage(async (page) => {
      await notesView(page).waitFor();
      await addNotes(page, "milk");
      await installExport(page);
      await page.waitForSelector(`[data-fragment="${EXPORT}"][data-state="active"]`);
      await page.evaluate((id) => window.platform.commands.call(id), `${EXPORT}/export-notes`);
      await expect(exportsShown(page)).resolves.toBe("1 exports");

      await remove(page, false);
      await installExport(page);
      await page.waitForSelector(`[data-fragment="${EXPORT}"][data-state="active"]`);
      await expect(exportsShown(page)).resolves.toBe("1 exports");

      await remove(page, true);
      await installExport(page);
      await page.waitForSelector(`[data-fragment="${EXPORT}"][data-state="active"]`);
      await expect(exportsShown(page)).resolves.toBe("0 exports");
    });
  });

  it("shows a notes-export whose server half cannot load failed, retries it, and notes keeps working", async () => {
    await withPage(
      async (page, context) => {
        await notesView(page).waitFor();
        const bundle = `**/archives/${EXPORT}/server/bundle.js`;
        await context.route(bundle, (route) => route.fulfill({ status: 500, body: "broken" }));
        await installExport(page);
        await page.waitForSelector(`[data-fragment="${EXPORT}"][data-state="failed"]`);
        await expect(
          entry(page, EXPORT).getByTestId("fragment-failure").innerText(),
        ).resolves.toContain("no server bundle (500)");

        // Notes keeps working. The failed fragment's action is still contributed (its
        // extensions live while it is resolved); used, it says why it cannot work.
        await addNotes(page, "still here");
        await show(page, `${NOTES}/notes`);
        await expect(page.getByTestId("notes-count").innerText()).resolves.toContain("1");
        await exportButton(page).click();
        await expect(notesView(page).getByRole("alert").innerText()).resolves.toContain(
          "notes-export server half",
        );
        await addNotes(page, "and this");
        await expect(page.getByTestId("notes-count").innerText()).resolves.toContain("2");

        await context.unroute(bundle);
        await show(page, "system.fragments/fragments");
        await entry(page, EXPORT).getByRole("button", { name: "Retry" }).click();
        await page.waitForSelector(`[data-fragment="${EXPORT}"][data-state="active"]`);
        await show(page, `${NOTES}/notes`);
        await exportButton(page).click();
        await expect(notesView(page).getByTestId("notes-action-result").innerText()).resolves.toBe(
          "Exported 2 notes (export 1)",
        );
      },
      [/server half did not follow the kernel/, /no server bundle \(500\)/, /status of 500/],
    );
  });

  it("retries the server halves' start: a failed start fails their fragments, retryable", async () => {
    await withPage(
      async (page) => {
        await activity(page, "Fragments").click();
        await page.waitForSelector(`[data-fragment="${NOTES}"][data-state="failed"]`);
        await expect(
          entry(page, NOTES).getByTestId("fragment-failure").innerText(),
        ).resolves.toContain("the server halves did not start");
        // The ServiceWorker registers again: a retry starts the server halves afresh.
        await page.evaluate(() => {
          (window as unknown as { failRegister: boolean }).failRegister = false;
        });
        await entry(page, NOTES).getByRole("button", { name: "Retry" }).click();
        await page.waitForSelector(`[data-fragment="${NOTES}"][data-state="active"]`);
        await addNotes(page, "after the retry");
        await show(page, `${NOTES}/notes`);
        await expect(page.getByTestId("notes-count").innerText()).resolves.toContain("1");
      },
      [/server halves did not start/],
      async (context) => {
        // The ServiceWorker cannot register (an insecure context, a refusing browser) until the
        // test says otherwise.
        await context.addInitScript(() => {
          const flag = window as unknown as { failRegister: boolean };
          flag.failRegister = true;
          const container = navigator.serviceWorker;
          const register = container.register.bind(container);
          container.register = (...args: Parameters<typeof register>) =>
            flag.failRegister
              ? Promise.reject(new Error("no ServiceWorker here"))
              : register(...args);
        });
      },
    );
  });
});
