// Seam 2 (statewalker/statewalker-kernel#73): "remove with data" of a server half where a server
// host runs it (the launch configurations node and wrangler). A plain removal keeps the fragment's
// DO data, so a reinstall finds it; "remove with data" deletes it, so a reinstall starts empty.
// The browser launch configuration's twin is tests/notes-export.e2e.test.ts.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Launched, launch } from "../scripts/launch.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const EXPORT = "org.statewalker.notes-export";
const HAS_WRANGLER = existsSync(join(ROOT, "node_modules", ".bin", "wrangler"));

let browser: Browser;
beforeAll(async () => {
  if (!existsSync(join(DIST, "index.html"))) {
    throw new Error(`no build at ${DIST}: run \`pnpm run build\` in apps/notes first`);
  }
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
});

async function open(app: Launched): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(app.url);
  await page.getByTestId("workbench").waitFor();
  return page;
}

/** notes-export from the app's catalog, as the consent screen installs it, active. */
async function install(page: Page) {
  await page.evaluate(async (id) => {
    const { fragments } = window.platform;
    const offer = (await fragments.available()).find((a) => a.id === id);
    if (!offer) throw new Error(`${id} is not offered`);
    await fragments.install(await fragments.inspect(offer.files, { source: offer.source }));
  }, EXPORT);
  await page.waitForFunction(
    (id) => window.platform.kernel.slots.getSnapshot(window.platform.slots.active).has(id),
    EXPORT,
  );
}

const remove = (page: Page, withData: boolean) =>
  page.evaluate(
    ([id, w]) => window.platform.fragments.remove(id as string, { withData: w as boolean }),
    [EXPORT, withData] as const,
  );

const exportsCount = (page: Page) =>
  page.evaluate(async (id) => {
    const res = await fetch(`fragments/${id}/exports`);
    return ((await res.json()) as { exports: unknown[] }).exports.length;
  }, EXPORT);

const exportOne = (page: Page) =>
  page.evaluate(async (id) => {
    const res = await fetch(`fragments/${id}/exports`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: [{ text: "kept?" }] }),
    });
    if (!res.ok) throw new Error(`export: ${res.status}`);
  }, EXPORT);

for (const mode of ["node", "wrangler"] as const) {
  describe.skipIf(mode === "wrangler" && !HAS_WRANGLER)(`remove with data on ${mode}`, () => {
    let app: Launched;
    let data: string;
    beforeAll(async () => {
      data = mkdtempSync(join(tmpdir(), `remove-data-${mode}-`));
      app = await launch(mode, { data });
    }, 180_000);
    afterAll(async () => {
      await app?.close();
      rmSync(data, { recursive: true, force: true });
    });

    it("keeps the DO data over a plain removal, and deletes it with 'remove with data'", async () => {
      const page = await open(app);
      try {
        await install(page);
        await exportOne(page);
        await expect(exportsCount(page)).resolves.toBe(1);

        await remove(page, false);
        await install(page);
        await expect(exportsCount(page)).resolves.toBe(1);

        await remove(page, true);
        await install(page);
        await expect(exportsCount(page)).resolves.toBe(0);
      } finally {
        await page.context().close();
      }
    }, 120_000);

    it("runs two removals of one fragment at once one after the other", async () => {
      const url = `${app.url}_launch/fragments/${EXPORT}/data/remove`;
      const post = () =>
        fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }).then((r) => r.status);
      await expect(Promise.all([post(), post()])).resolves.toEqual([200, 200]);
      // The server half still answers, from one server process (its data empty).
      const page = await open(app);
      try {
        await install(page);
        await expect(exportsCount(page)).resolves.toBe(0);
      } finally {
        await page.context().close();
      }
    }, 120_000);

    it("takes a 'remove with data' only from the app's own pages", async () => {
      const url = `${app.url}_launch/fragments/${EXPORT}/data/remove`;
      const post = (headers: Record<string, string>) =>
        fetch(url, { method: "POST", headers, body: "{}" }).then((r) => r.status);
      await expect(
        post({ "content-type": "application/json", "sec-fetch-site": "cross-site" }),
      ).resolves.toBe(403);
      await expect(post({ "content-type": "text/plain" })).resolves.toBe(415);
      await expect(
        fetch(`${app.url}_launch/fragments/org.example.nowhere/data/remove`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }).then((r) => r.status),
      ).resolves.toBe(404);
    });
  });
}
