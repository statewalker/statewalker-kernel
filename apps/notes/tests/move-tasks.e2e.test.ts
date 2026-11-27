// Seam 2 (statewalker/statewalker-root#410): a publish under `fragments.<id>.` goes to the queue on
// that fragment's home. With notes-export moved to a second CellB Node host (`url:`), a task
// published from the first host is served in the second host's queue and its reply reaches the
// publisher; a wildcard subscription on the first host never sees it; an unreachable home fails
// the publish with nothing queued on the first host.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Launched, launch } from "../scripts/launch.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const EXPORT = "org.statewalker.notes-export";
const SUBJECT = `fragments.${EXPORT}.export-slowly`;

let browser: Browser;
const temps: string[] = [];
const temp = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};
beforeAll(async () => {
  if (!existsSync(join(DIST, "index.html")))
    throw new Error(`no build at ${DIST}: run \`pnpm run build\` in apps/notes first`);
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** One operation on a host's system.tasks queue, as its client half sends it. */
async function queue(app: Launched, method: string, ...args: unknown[]): Promise<unknown> {
  const response = await fetch(new URL("fragments/system.tasks/queue", app.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "queue", method, args }),
  });
  const body = (await response.json()) as { value?: unknown; error?: string };
  if (!response.ok) throw new Error(body.error);
  return body.value;
}

/** Waits until `app`'s queue has the runner's subscription for notes-export's command. */
async function served(app: Launched) {
  for (let i = 0; i < 300; i++) {
    const subs = (await queue(app, "listSubscriptions", "local")) as { name: string }[];
    if (subs.some((s) => s.name === `${EXPORT}.export-slowly`)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no runner subscribed on ${app.url}`);
}

const jobsOn = async (app: Launched, task: string) =>
  ((await queue(app, "jobsOf", "local", task)) as unknown[]).length;

async function installExport(page: Page) {
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

/** A task published and waited for from the page: its reply, or the error's message. */
const publish = (page: Page) =>
  page.evaluate(
    (subject) =>
      window.platform.commands
        .call<{ task: string; result?: unknown; error?: string }>("system.tasks/publish", {
          subject,
          payload: { delay_ms: 0 },
        })
        .catch((error: Error) => ({ failed: `${error.message} ${String(error.cause ?? "")}` })),
    SUBJECT,
  ) as Promise<{ task: string; result?: unknown; error?: string; failed?: string }>;

describe("system.tasks forwards publishes to a fragment's home", () => {
  let a: Launched;
  let b: Launched;
  beforeAll(async () => {
    a = await launch("node", { data: temp("tasks-a-") });
    // The second host runs system.tasks (the queue there); notes-export arrives by a Move.
    b = await launch("node", {
      data: temp("tasks-b-"),
      fragments: ["system.tasks"],
      allowOrigins: [new URL(a.url).origin],
    });
  }, 180_000);
  afterAll(async () => {
    await a?.close();
    await b?.close();
  });

  it("serves the task on the fragment's home after a Move, never on the first host's wildcard", async () => {
    const page = await (await browser.newContext()).newPage();
    page.setDefaultTimeout(30_000);
    try {
      await page.goto(a.url);
      await page.getByTestId("workbench").waitFor();
      await installExport(page);
      // A wildcard subscription on the first host.
      await queue(
        a,
        "subscribe",
        "local",
        { name: "all", filter: { subject: "fragments.>" } },
        "user",
      );
      const take = () =>
        queue(
          a,
          "take",
          "local",
          "all",
          { id: "user", destinations: [] },
          { limit: 50 },
        ) as Promise<unknown[]>;

      // Before the Move: served here.
      await served(a);
      const here = await publish(page);
      expect(here.result, here.failed ?? here.error).toBeDefined();
      expect(await jobsOn(a, here.task)).toBe(1);
      expect(await take()).toHaveLength(1); // the wildcard saw that one

      const moved = await page.evaluate(
        ([id, to]) =>
          window.placement.move(id as string, to as `url:${string}`).then(
            () => undefined,
            (e: Error) => e.message,
          ),
        [EXPORT, `url:${b.url}`] as const,
      );
      expect(moved).toBeUndefined();
      await served(b);

      // After it: published from the first host, served in the second host's queue, the reply
      // back here.
      const there = await publish(page);
      expect(there.result, there.failed ?? there.error).toBeDefined();
      expect(await jobsOn(b, there.task)).toBe(1);
      await expect(jobsOn(a, there.task)).resolves.toBe(0);
      expect(await take()).toEqual([]);

      // Its home unreachable: the publish fails, and nothing is queued on the first host.
      await b.close();
      const failed = await publish(page);
      expect(failed.failed).toMatch(/unreachable/);
      expect(await take()).toEqual([]);
    } finally {
      await page.close();
    }
  }, 180_000);
});
