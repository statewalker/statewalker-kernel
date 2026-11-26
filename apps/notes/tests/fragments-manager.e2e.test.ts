// Seam 2 (statewalker/statewalker-root#261): system.fragments' manager view through apps/notes in
// Chromium. An archive uploaded from a file goes through the consent screen: declining changes
// nothing, accepting installs and activates it; a refused archive shows its reasons and cannot be
// installed; a disable that cascades lists the dependents first; a removal keeps the fragment's
// data unless "remove with data" is confirmed. Each test opens a new browser context, so it
// starts from a fresh profile. The app is `dist/`.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import application from "../application.json" with { type: "json" };
import { type StaticServer, serveStatic } from "../scripts/static-server.mjs";

const DIST = resolve(import.meta.dirname, "..", "dist");
const NOTES = "org.statewalker.notes";
const EXTRA = "org.example.extra";
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

/** An archive as the manager view uploads it: a JSON object of file names to texts. */
function archiveFile(manifest: Record<string, unknown>, client: unknown[] = []) {
  const files = {
    "fragment.jsonc": JSON.stringify({
      $schema: "fragment.v1.schema.json",
      version: "1.0.0",
      engines: { platform: "^0.1.0" },
      aspects: { client: {} },
      ...manifest,
    }),
    "fragment.client.jsonc": JSON.stringify({
      $schema: "fragment-aspect.v1.schema.json",
      extensions: client,
    }),
  };
  return {
    name: `${String(manifest.id)}.json`,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(files)),
  };
}

/** The extra fragment: it requires notes, has a settings page, and exposes a command. */
const EXTRA_FILE = archiveFile({ id: EXTRA, name: "Extra", requires: { [NOTES]: "*" } }, [
  {
    point: "settings",
    data: {
      title: "Extra",
      schema: { type: "object", properties: { motto: { type: "string", title: "Motto" } } },
    },
  },
  {
    point: "commands",
    data: {
      operation: { operationId: "shout", summary: "Shout" },
      exposures: { agent: { action: "read" } },
    },
  },
]);

const view = (page: Page) => page.getByTestId("fragments-view");
const consent = (page: Page) => page.getByTestId("consent-dialog");
const entry = (page: Page, id: string) =>
  view(page).locator(`[data-testid="fragment-entry"][data-fragment="${id}"]`);
const installed = (page: Page, id: string) =>
  page.evaluate(
    (fragment) =>
      window.platform.kernel.slots.getSnapshot(window.platform.slots.installed).has(fragment),
    id,
  );

async function openFragments(page: Page) {
  await page.getByTestId("activitybar").getByRole("button", { name: "Fragments" }).click();
  await view(page).waitFor();
}

async function upload(page: Page, file: ReturnType<typeof archiveFile>) {
  await view(page).getByLabel("Install from a file").setInputFiles(file);
  await consent(page).waitFor();
}

describe("the fragment manager view", () => {
  it("lists the app's fragments, not the core ones", async () => {
    await withPage(async (page) => {
      await openFragments(page);
      await entry(page, NOTES).waitFor();
      await expect(entry(page, NOTES).getAttribute("data-state")).resolves.toBe("active");
      const ids = await view(page)
        .locator('[data-testid="fragment-entry"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-fragment")));
      expect(ids.some((id) => id?.startsWith("system."))).toBe(false);
    });
  });

  it("shows what an archive asks for; declining changes nothing, accepting installs it", async () => {
    await withPage(async (page) => {
      await openFragments(page);
      await upload(page, EXTRA_FILE);
      const dialog = consent(page);
      await expect(dialog.getByTestId("consent-source").innerText()).resolves.toBe(`${EXTRA}.json`);
      await expect(dialog.getByTestId("consent-content-hash").innerText()).resolves.toMatch(
        /^sha256:[0-9a-f]{64}$/,
      );
      await expect(dialog.getByTestId("consent-requires").innerText()).resolves.toContain(
        `${NOTES} *: installed`,
      );
      await expect(dialog.getByTestId("consent-exposures").innerText()).resolves.toBe(
        `${EXTRA}/shout (agent)`,
      );
      for (const item of ["platform", "bindings", "server-half", "agent-plugins", "secrets"])
        await dialog.getByTestId(`consent-${item}`).waitFor();

      await dialog.getByRole("button", { name: "Decline" }).click();
      await dialog.waitFor({ state: "detached" });
      await expect(installed(page, EXTRA)).resolves.toBe(false);

      await upload(page, EXTRA_FILE);
      await consent(page).getByRole("button", { name: "Install" }).click();
      await consent(page).waitFor({ state: "detached" });
      await page.waitForFunction(
        (id) => document.querySelector(`[data-fragment="${id}"][data-state="active"]`) !== null,
        EXTRA,
      );
      // Its contributions are live: its command is on the bus, its settings page in the view.
      await expect(
        page.evaluate((id) => window.platform.commands.get(`${id}/shout`) !== undefined, EXTRA),
      ).resolves.toBe(true);
      await expect(
        page.evaluate(
          (id) => window.platform.settings.state().pages.some((p) => p.fragment === id),
          EXTRA,
        ),
      ).resolves.toBe(true);
    });
  });

  it("refuses an archive for another platform, or with an unmet requirement, with the reasons", async () => {
    await withPage(async (page) => {
      await openFragments(page);
      await upload(
        page,
        archiveFile({
          id: "org.example.future",
          engines: { platform: "^9.0.0" },
          requires: { "org.example.nowhere": "^1.0.0" },
        }),
      );
      const codes = await consent(page)
        .getByTestId("consent-refusal")
        .evaluateAll((els) => els.map((el) => el.getAttribute("data-code")).sort());
      expect(codes).toEqual(["incompatible-platform", "unmet-requirement"]);
      await expect(
        consent(page).getByRole("button", { name: "Install" }).isDisabled(),
      ).resolves.toBe(true);
      await consent(page).getByRole("button", { name: "Decline" }).click();
      await expect(installed(page, "org.example.future")).resolves.toBe(false);
    });
  });

  it("lists the dependents before a cascading disable, and enables again", async () => {
    await withPage(async (page) => {
      await openFragments(page);
      await upload(page, EXTRA_FILE);
      await consent(page).getByRole("button", { name: "Install" }).click();
      await entry(page, EXTRA).waitFor();

      await entry(page, NOTES).getByRole("button", { name: "Disable" }).click();
      const confirm = page.getByTestId("fragments-confirm");
      await expect(confirm.getByTestId("fragments-confirm-dependents").innerText()).resolves.toBe(
        EXTRA,
      );
      await confirm.getByRole("button", { name: "Disable all" }).click();
      await page.waitForSelector(`[data-fragment="${NOTES}"][data-state="disabled"]`);
      await expect(entry(page, EXTRA).getAttribute("data-state")).resolves.toBe("unresolved");

      await entry(page, NOTES).getByRole("button", { name: "Enable" }).click();
      await page.waitForSelector(`[data-fragment="${EXTRA}"][data-state="active"]`);
    });
  });

  it("removes keeping the data, and removes with it once confirmed", async () => {
    await withPage(async (page) => {
      await openFragments(page);
      const install = async () => {
        await upload(page, EXTRA_FILE);
        await consent(page).getByRole("button", { name: "Install" }).click();
        await page.waitForSelector(`[data-fragment="${EXTRA}"][data-state="active"]`);
      };
      await install();
      await page.evaluate(
        (id) => window.platform.settings.of(id).set("motto", "carpe diem"),
        EXTRA,
      );
      const stored = () =>
        page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), EXTRA_KEY);
      await expect(stored()).resolves.toEqual({ version: 1, values: { motto: "carpe diem" } });

      await entry(page, EXTRA).getByRole("button", { name: "Remove", exact: true }).click();
      await page.getByTestId("fragments-confirm").getByRole("button", { name: "Remove" }).click();
      await entry(page, EXTRA).waitFor({ state: "detached" });
      await expect(stored()).resolves.toEqual({ version: 1, values: { motto: "carpe diem" } });

      await install();
      await entry(page, EXTRA).getByRole("button", { name: "Remove with data" }).click();
      const confirm = page.getByTestId("fragments-confirm");
      // Cancelling keeps everything.
      await confirm.getByRole("button", { name: "Cancel" }).click();
      await expect(installed(page, EXTRA)).resolves.toBe(true);
      await entry(page, EXTRA).getByRole("button", { name: "Remove with data" }).click();
      await page
        .getByTestId("fragments-confirm")
        .getByRole("button", { name: "Remove and delete its data" })
        .click();
      await entry(page, EXTRA).waitFor({ state: "detached" });
      await expect(stored()).resolves.toBeNull();
    });
  });

  it("shows a refused removal's reason: a baseline fragment stays", async () => {
    await withPage(async (page) => {
      await openFragments(page);
      await entry(page, NOTES).getByRole("button", { name: "Remove", exact: true }).click();
      await page.getByTestId("fragments-confirm").getByRole("button", { name: "Remove" }).click();
      await page.getByTestId("fragments-error").waitFor();
      await expect(installed(page, NOTES)).resolves.toBe(true);
    });
  });
});
