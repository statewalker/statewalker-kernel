// Seam 2 (statewalker/statewalker-root#411): host-jobs.node on the `node` launch configuration. The
// jobs-demo fragment requires the `host-jobs` binding and ships scripts; its task-exposed commands
// run them as OS processes on the host, each output line in the job log. A browser host lacks the
// binding and refuses the install, naming it.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Launched, launch } from "../scripts/launch.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const JOBS = "org.statewalker.jobs-demo";

let browser: Browser;
const temps: string[] = [];
beforeAll(async () => {
  if (!existsSync(join(DIST, "index.html")))
    throw new Error(`no build at ${DIST}: run \`pnpm run build\` in apps/notes first`);
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser?.close();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function open(app: Launched): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(app.url);
  await page.getByTestId("workbench").waitFor();
  return page;
}

/** Installs jobs-demo from the catalog: undefined, or the refusal's message. */
const install = (page: Page) =>
  page.evaluate(async (id) => {
    const { fragments } = window.platform;
    const offer = (await fragments.available()).find((a) => a.id === id);
    if (!offer) return `${id} is not offered`;
    try {
      await fragments.install(await fragments.inspect(offer.files, { source: offer.source }));
      return undefined;
    } catch (error) {
      return (error as Error).message;
    }
  }, JOBS);

/** A command of system.tasks, called from the page as the user. */
const tasks = <T>(page: Page, command: string, input: unknown) =>
  page.evaluate(
    ([c, i]) =>
      window.platform.commands.call(c as string, i).then(
        (value) => ({ value }),
        (error: Error) => ({ error: `${error.message} ${String(error.cause ?? "")}` }),
      ),
    [`system.tasks/${command}`, input] as const,
  ) as Promise<{ value?: T; error?: string }>;

type Log = { entries: { progress: unknown; outcome?: string }[] };
const lines = (log: Log) =>
  log.entries
    .map((e) => e.progress as { stream?: string; line?: string } | null)
    .filter((p) => p?.line !== undefined)
    .map((p) => `${p?.stream}: ${p?.line}`);

describe("host-jobs on a CellB Node host", () => {
  let app: Launched;
  beforeAll(async () => {
    const data = mkdtempSync(join(tmpdir(), "host-jobs-e2e-"));
    temps.push(data);
    app = await launch("node", { data });
  }, 180_000);
  afterAll(async () => {
    await app?.close();
  });

  it("runs a fragment's script through its task-exposed command: its lines, then done", async () => {
    const page = await open(app);
    try {
      expect(await install(page)).toBeUndefined();
      const run = await tasks<{ task: string; job: string; result: unknown }>(page, "publish", {
        subject: `fragments.${JOBS}.count`,
        payload: { n: 2 },
      });
      expect(run.value, run.error).toMatchObject({ result: { exitCode: 0 } });
      const log = await tasks<Log>(page, "job", { job: run.value?.job });
      expect(lines(log.value as Log)).toEqual([
        "stdout: count 1",
        "stdout: count 2",
        "stderr: counted to 2",
      ]);
      expect(log.value?.entries.at(-1)?.outcome).toBe("done");

      // A script outside the fragment's archive is refused, nothing run.
      const refused = await tasks<{ error?: string }>(page, "publish", {
        subject: `fragments.${JOBS}.escape`,
      });
      expect(refused.value?.error).toMatch(/leaves the fragment's archive: refused/);
    } finally {
      await page.close();
    }
  }, 120_000);

  it("terminates the process on a cancel and ends the job cancelled", async () => {
    const page = await open(app);
    try {
      const started = await tasks<{ task: string }>(page, "publish", {
        subject: `fragments.${JOBS}.wait`,
        wait: false,
      });
      const task = started.value?.task as string;
      let pids: number[] = [];
      let job = "";
      for (let i = 0; i < 100 && pids.length < 2; i++) {
        const jobs = await tasks<{ jobs: { job: string }[] }>(page, "jobs", { task });
        job = jobs.value?.jobs[0]?.job ?? "";
        if (job) {
          const log = await tasks<Log>(page, "job", { job });
          pids = lines(log.value as Log)
            .map((l) => /^stdout: (?:child|self) (\d+)$/.exec(l)?.[1])
            .filter((p): p is string => p !== undefined)
            .map(Number);
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(pids).toHaveLength(2);
      expect((await tasks(page, "cancel", { task })).error).toBeUndefined();
      let outcome: string | undefined;
      for (let i = 0; i < 100 && outcome === undefined; i++) {
        const log = await tasks<Log>(page, "job", { job });
        outcome = log.value?.entries.at(-1)?.outcome;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(outcome).toBe("cancelled");
      // SIGTERM to the group, then SIGKILL after the grace period (the child ignores SIGTERM).
      const alive = (pid: number) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      for (let i = 0; i < 120 && pids.some(alive); i++)
        await new Promise((r) => setTimeout(r, 100));
      expect(pids.filter(alive)).toEqual([]);
    } finally {
      await page.close();
    }
  }, 120_000);
});

describe("a host without the host-jobs binding", () => {
  it("refuses the fragment's install, naming the binding (browser)", async () => {
    const app = await launch("browser");
    const page = await open(app);
    try {
      expect(await install(page)).toMatch(/needs the binding "host-jobs", which this host lacks/);
    } finally {
      await page.close();
      await app.close();
    }
  }, 120_000);
});
