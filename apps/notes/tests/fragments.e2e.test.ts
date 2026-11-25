// Seam 2 (statewalker/statewalker-root#259, the server-half tracer): the notes fragment's server half,
// one fragment DO at `idFromName("org.statewalker.notes")`, reached at
// `/fragments/org.statewalker.notes/…` in each launch configuration (scripts/launch.mjs):
//
//   browser   CellB in the page's origin: a ServiceWorker routing to a pool of shard workers;
//   node      CellB on Node: one fragment host serving every server half;
//   wrangler  `wrangler dev` behind the app's server.
//
// The built app (`pnpm run build`) is served by each; the page saves and reads notes through the
// fragment DO. Unknown fragments answer 404 and disabled ones 503 without waking a DO, and
// `/peers/<self>/fragments/…` answers as `/fragments/…`.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Launched, launch } from "../scripts/launch.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const NOTES = "org.statewalker.notes";
const PEER = "peer-self";
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

/** The app opened, its server halves ready (in the browser: the pool following the kernel). */
async function open(app: Launched): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  await page.goto(app.url);
  await page.waitForFunction(() => window.platform !== undefined && window.launch !== undefined);
  if (app.mode === "browser") {
    await page.waitForFunction(() => window.fragmentServers !== undefined);
    await page.evaluate(() => window.fragmentServers?.settled());
  }
  return page;
}

/** A request from the page, as the client half would make it. */
const call = (page: Page, path: string, init?: { method: string; body?: unknown }) =>
  page.evaluate(
    async ([p, i]) => {
      const res = await fetch(p, {
        method: i?.method ?? "GET",
        ...(i?.body !== undefined
          ? { body: JSON.stringify(i.body), headers: { "content-type": "application/json" } }
          : {}),
      });
      const text = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {}
      return { status: res.status, text, json };
    },
    [path, init] as const,
  );

const notesOf = (page: Page) =>
  call(page, `fragments/${NOTES}/notes`).then((r) =>
    (r.json as { notes: { text: string }[] }).notes.map((n) => n.text),
  );

for (const mode of ["browser", "node", "wrangler"] as const) {
  describe.skipIf(mode === "wrangler" && !HAS_WRANGLER)(`launch configuration: ${mode}`, () => {
    let app: Launched;
    let data: string | undefined;
    beforeAll(async () => {
      data = mode === "browser" ? undefined : mkdtempSync(join(tmpdir(), `notes-${mode}-`));
      app = await launch(mode, { peerId: PEER, ...(data ? { data } : {}) });
    }, 180_000);
    afterAll(async () => {
      await app?.close();
      if (data) rmSync(data, { recursive: true, force: true });
    });

    it("saves and reads notes through the notes fragment DO", async () => {
      const page = await open(app);
      const stamp = Date.now().toString(36);
      const before = await notesOf(page);
      const saved = await call(page, `fragments/${NOTES}/notes`, {
        method: "POST",
        body: { text: `buy milk ${stamp}` },
      });
      expect(saved.status, saved.text).toBe(201);
      expect(saved.json).toMatchObject({ text: `buy milk ${stamp}`, count: before.length + 1 });
      expect(await notesOf(page)).toEqual([...before, `buy milk ${stamp}`]);
      // A refused note: the DO's own answer.
      expect(
        (await call(page, `fragments/${NOTES}/notes`, { method: "POST", body: {} })).status,
      ).toBe(400);
      // Another page (a reload) reads what the DO kept.
      await page.reload();
      await page.waitForFunction(() => window.platform !== undefined);
      if (mode === "browser") {
        await page.waitForFunction(() => window.fragmentServers !== undefined);
        await page.evaluate(() => window.fragmentServers?.settled());
      }
      expect(await notesOf(page)).toContain(`buy milk ${stamp}`);
      await page.context().close();
    }, 120_000);

    it("answers 404 for a fragment the host does not have, and /peers/<self>/ as /", async () => {
      const page = await open(app);
      expect((await call(page, "fragments/org.example.nope/notes")).status).toBe(404);
      const direct = await notesOf(page);
      const viaPeer = await call(page, `peers/${PEER}/fragments/${NOTES}/notes`);
      expect(viaPeer.status, viaPeer.text).toBe(200);
      expect((viaPeer.json as { notes: { text: string }[] }).notes.map((n) => n.text)).toEqual(
        direct,
      );
      await page.context().close();
    }, 120_000);

    it.skipIf(mode === "wrangler")(
      "answers 503 for a disabled fragment without waking its DO; enabled again, it serves",
      async () => {
        const page = await open(app);
        const before = await notesOf(page);
        if (mode === "browser") {
          // The kernel disables the fragment; the pool follows, and the router answers 503.
          await page.evaluate(async (id) => {
            await window.platform.kernel.disable(id);
            await window.fragmentServers?.settled();
          }, NOTES);
        } else await app.host?.disable(NOTES);
        for (let i = 0; i < 3; i++) {
          const res = await call(page, `fragments/${NOTES}/notes`, {
            method: "POST",
            body: { text: `while disabled ${i}` },
          });
          expect(res.status, res.text).toBe(503);
        }
        if (mode === "browser") {
          await page.evaluate(async (id) => {
            await window.platform.kernel.enable(id);
            await window.fragmentServers?.settled();
          }, NOTES);
        } else await app.host?.enable(NOTES);
        // Nothing the 503s carried reached the DO.
        expect(await notesOf(page)).toEqual(before);
        await page.context().close();
      },
      120_000,
    );
  });
}
