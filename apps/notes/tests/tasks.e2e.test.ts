// Seam 2 (statewalker/statewalker-root#409): system.tasks' queue in its fragment DO, on every host
// of the server-half tracer (scripts/launch.mjs: browser, node, wrangler). notes-export's
// `export-slowly` is exposed as a task: the Exports view starts it, follows its job log (over a
// reload, after the last stamp it showed), shows the reply, and cancels it. A task waiting while its
// fragment is disabled survives a restart of the host and is processed once the fragment returns.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Launched, launch } from "../scripts/launch.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const NOTES = "org.statewalker.notes";
const EXPORT = "org.statewalker.notes-export";
const SLOWLY_SUBJECT = `fragments.${EXPORT}.export-slowly`;
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

/** The app opened in `context`, its server halves ready and system.tasks serving. */
async function open(context: BrowserContext, app: Launched): Promise<Page> {
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(app.url);
  await page.getByTestId("workbench").waitFor();
  await page.waitForFunction(() =>
    window.platform.commands.list().some((c) => c.id === "system.tasks/publish"),
  );
  return page;
}

async function addNotes(page: Page, ...texts: string[]) {
  for (const text of texts)
    await page.evaluate(
      ([id, t]) => window.platform.commands.call(id as string, { text: t }),
      [`${NOTES}/add-note`, text],
    );
}

/** notes-export from the app's catalog, as the consent screen installs it. */
async function installExport(page: Page) {
  await page.evaluate(async (id) => {
    const { fragments } = window.platform;
    const offer = (await fragments.available()).find((a) => a.id === id);
    if (!offer) throw new Error(`${id} is not offered`);
    await fragments.install(await fragments.inspect(offer.files, { source: offer.source }));
  }, EXPORT);
  await page.waitForFunction(
    (id) =>
      window.platform.kernel.slots.getSnapshot(window.platform.slots.active).has(id) &&
      window.platform.commands.list().some((c) => c.id === `${id}/export-slowly`),
    EXPORT,
  );
}

async function openExports(page: Page) {
  await page
    .getByTestId("activitybar")
    .getByRole("button", { name: "Exports", exact: true })
    .click();
  await page.getByTestId("exports-view").waitFor();
}

const run = (page: Page) => page.getByTestId("export-run");
const runLog = (page: Page) =>
  run(page).getByTestId("export-run-log").locator("li").allInnerTexts();

/** Waits until the task's job index has its result (polled from here, every 500 ms, 30 s). */
async function answered(page: Page, task: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const done = await page.evaluate(async (t) => {
      const { jobs } = await window.platform.commands.call<{
        jobs: { reply?: { result?: unknown } }[];
      }>("system.tasks/jobs", { task: t });
      return jobs.some((j) => j.reply?.result !== undefined);
    }, task);
    if (done) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`task ${task} has no result after 30 s`);
}

const exportsCount = (page: Page) =>
  page.evaluate(async (id) => {
    const res = await fetch(`fragments/${id}/exports`);
    return ((await res.json()) as { exports: unknown[] }).exports.length;
  }, EXPORT);

for (const mode of ["browser", "node", "wrangler"] as const) {
  describe.skipIf(mode === "wrangler" && !HAS_WRANGLER)(`system.tasks on ${mode}`, () => {
    let app: Launched;
    let data: string | undefined;
    beforeAll(async () => {
      data = mode === "browser" ? undefined : mkdtempSync(join(tmpdir(), `tasks-${mode}-`));
      app = await launch(mode, data ? { data } : {});
    }, 180_000);
    afterAll(async () => {
      await app?.close();
      if (data) rmSync(data, { recursive: true, force: true });
    });

    it("starts the task from the Exports view, follows it over a reload, and shows the reply", async () => {
      const context = await browser.newContext();
      try {
        let page = await open(context, app);
        await addNotes(page, "a", "b", "c", "d", "e", "f");
        await installExport(page);
        // The host's exports so far (a server host's DO outlives the browser's contexts).
        const made = await exportsCount(page);
        await openExports(page);
        await page.getByRole("button", { name: "Export as a task" }).click();
        await page.waitForFunction(
          () => document.querySelectorAll('[data-testid="export-run-log"] li').length >= 2,
        );
        const before = await runLog(page);
        expect(before.slice(0, 2)).toEqual(["0 of 6 notes", "1 of 6 notes"]);

        // A reload: the run is followed again from its last stamp; what was shown stays, once.
        await page.reload();
        await page.getByTestId("workbench").waitFor();
        await openExports(page);
        await page.waitForSelector('[data-testid="export-run"][data-state="done"]', {
          timeout: 60_000,
        });
        const after = await runLog(page);
        expect(after.slice(0, before.length)).toEqual(before);
        // Each attempt's entries once each, in order: nothing read twice.
        const attempts = after.join("\n").split("attempt restarted");
        for (const attempt of attempts) {
          const lines = attempt.split("\n").filter(Boolean);
          expect(new Set(lines).size).toBe(lines.length);
        }
        expect(after.at(-1)).toBe("6 of 6 notes");
        await expect(run(page).getByTestId("export-run-reply").innerText()).resolves.toMatch(
          /^Exported 6 notes \(export \d+\)$/,
        );
        // At least once, made once: the handler deduplicates by the task's id.
        await expect(exportsCount(page)).resolves.toBe(made + 1);
        page = await open(context, app); // a second tab reads the same queue
        await expect(exportsCount(page)).resolves.toBe(made + 1);
      } finally {
        await context.close();
      }
    }, 120_000);

    it("answers only the app's pages: no other content type, no other site", async () => {
      const context = await browser.newContext();
      try {
        const page = await open(context, app);
        const operation = JSON.stringify({
          kind: "queue",
          method: "publish",
          args: ["local", { subject: SLOWLY_SUBJECT, payload: {} }, "user"],
        });
        // A body a page of another origin could send without a preflight: refused.
        await expect(
          page.evaluate(
            (body) =>
              fetch("fragments/system.tasks/queue", {
                method: "POST",
                headers: { "content-type": "text/plain" },
                body,
              }).then((r) => r.status),
            operation,
          ),
        ).resolves.toBe(415);
        if (mode !== "browser") {
          // A request a browser marks as from another site never reaches a DO.
          const res = await fetch(`${app.url}fragments/system.tasks/queue`, {
            method: "POST",
            headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
            body: operation,
          });
          expect(res.status).toBe(403);
        }
      } finally {
        await context.close();
      }
    });

    it("makes an export once per task id, however often it runs", async () => {
      const context = await browser.newContext();
      try {
        const page = await open(context, app);
        await installExport(page);
        const made = await exportsCount(page);
        const call = `e2e-${mode}-${Date.now()}`;
        const post = () =>
          page.evaluate(
            async ([id, c]) => {
              const res = await fetch(`fragments/${id}/exports`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ notes: [{ text: "once" }], call: c }),
              });
              return { status: res.status, id: ((await res.json()) as { id: number }).id };
            },
            [EXPORT, call] as const,
          );
        const first = await post();
        const again = await post();
        expect(first.status).toBe(201);
        expect(again).toEqual({ status: 200, id: first.id });
        await expect(exportsCount(page)).resolves.toBe(made + 1);
      } finally {
        await context.close();
      }
    });

    it("cancels a running task: it ends as cancelled", async () => {
      const context = await browser.newContext();
      try {
        const page = await open(context, app);
        await addNotes(page, "a", "b", "c", "d", "e", "f", "g", "h");
        await installExport(page);
        const made = await exportsCount(page);
        await openExports(page);
        await page.getByRole("button", { name: "Export as a task" }).click();
        await page.waitForSelector('[data-testid="export-run"][data-state="running"]');
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await page.waitForSelector('[data-testid="export-run"][data-state="cancelled"]');
        await expect(run(page).getByTestId("export-run-reply").innerText()).resolves.toBe(
          "Cancelled",
        );
        await expect(exportsCount(page)).resolves.toBe(made);
      } finally {
        await context.close();
      }
    }, 60_000);

    it.skipIf(mode === "browser")(
      "keeps a waiting task over a restart of the host, and processes it afterwards",
      async () => {
        const context = await browser.newContext();
        try {
          let page = await open(context, app);
          await addNotes(page, "kept");
          await installExport(page);
          const made = await exportsCount(page);
          // Its fragment disabled: the task waits in the queue (the DO), no runner serves it.
          await page.evaluate((id) => window.platform.fragments.disable(id), EXPORT);
          const task = await page.evaluate(
            (subject) =>
              window.platform.commands
                .call<{ task: string }>("system.tasks/publish", {
                  subject,
                  payload: { delay_ms: 0 },
                  wait: false,
                })
                .then((r) => r.task),
            SLOWLY_SUBJECT,
          );
          await page.close();

          // The host restarts on the same data, at the same address (the page's profile is the
          // origin's).
          const port = Number(new URL(app.url).port);
          await app.close();
          app = await launch(mode, { ...(data ? { data } : {}), port });
          page = await open(context, app);
          await page.evaluate((id) => window.platform.fragments.enable(id), EXPORT);
          await page.waitForFunction(
            (id) => window.platform.kernel.slots.getSnapshot(window.platform.slots.active).has(id),
            EXPORT,
          );
          await answered(page, task);
          await expect(exportsCount(page)).resolves.toBe(made + 1);
        } finally {
          await context.close();
        }
      },
      180_000,
    );

    it.skipIf(mode !== "browser")(
      "keeps a waiting task over the pool's restart (every tab closed), and processes it afterwards",
      async () => {
        const context = await browser.newContext();
        try {
          let page = await open(context, app);
          await addNotes(page, "kept");
          await installExport(page);
          const made = await exportsCount(page);
          await page.evaluate((id) => window.platform.fragments.disable(id), EXPORT);
          const task = await page.evaluate(
            (subject) =>
              window.platform.commands
                .call<{ task: string }>("system.tasks/publish", {
                  subject,
                  payload: { delay_ms: 0 },
                  wait: false,
                })
                .then((r) => r.task),
            SLOWLY_SUBJECT,
          );
          // The last tab closes: the shard workers (the host) go; the DO's storage stays (OPFS).
          await page.close();
          page = await open(context, app);
          await page.evaluate((id) => window.platform.fragments.enable(id), EXPORT);
          await page.waitForFunction(
            (id) => window.platform.kernel.slots.getSnapshot(window.platform.slots.active).has(id),
            EXPORT,
          );
          await answered(page, task);
          await expect(exportsCount(page)).resolves.toBe(made + 1);
        } finally {
          await context.close();
        }
      },
      120_000,
    );
  });
}
