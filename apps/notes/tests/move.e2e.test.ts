// Seam 2 (statewalker/statewalker-root#263): Move of a fragment's server half, with its data, to a
// second CellB Node host. Client halves keep calling `<base>fragments/{id}/…`; the route table in
// the profile sends them to the fragment's home. The source keeps its data, handed over (it cannot
// run), until the Move is confirmed; a rollback runs it again on that data.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Launched, launch } from "../scripts/launch.mjs";

const ROOT = resolve(import.meta.dirname, "..");
const DIST = join(ROOT, "dist");
const NOTES = "org.statewalker.notes";

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

async function open(app: Launched): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(app.url);
  await page.getByTestId("notes-view").waitFor();
  return page;
}

async function reload(page: Page) {
  await page.reload();
  await page.getByTestId("notes-view").waitFor();
}

async function addNote(page: Page, text: string) {
  const view = page.getByTestId("notes-view");
  await view.getByRole("textbox").fill(text);
  await view.getByRole("button", { name: "Add note" }).click();
  await view.getByRole("listitem").filter({ hasText: text }).waitFor();
}

/** The notes the view lists (each item's text, without its "Copy" button's label). */
const notes = async (page: Page) =>
  (await page.getByTestId("notes-view").getByRole("listitem").allTextContents()).map((t) =>
    t.replace(/Copy$/, ""),
  );

/** A placement call in the page: its error's message, or undefined when it succeeded. */
const call = (page: Page, method: string, ...args: string[]) =>
  page.evaluate(
    async ([m, a]) => {
      try {
        const placement = window.placement as unknown as Record<
          string,
          (...x: string[]) => Promise<void>
        >;
        await placement[m as string]?.(...(a as string[]));
        return undefined;
      } catch (error) {
        return (error as Error).message;
      }
    },
    [method, args] as const,
  );

const origin = (url: string) => new URL(url).origin;

describe("Move of a fragment to a second CellB Node host", () => {
  let a: Launched;
  let b: Launched;
  let other: Launched;
  let dataA: string;
  beforeAll(async () => {
    dataA = temp("move-a-");
    a = await launch("node", { data: dataA });
    // The second host runs nothing yet; it lets the first one's pages in.
    b = await launch("node", {
      data: temp("move-b-"),
      fragments: [],
      allowOrigins: [origin(a.url)],
    });
    // A host offering another version of the notes fragment.
    other = await launch("node", {
      data: temp("move-c-"),
      fragments: [],
      allowOrigins: [origin(a.url)],
      versions: { [NOTES]: "9.9.9" },
    });
  }, 180_000);
  afterAll(async () => {
    await a?.close();
    await b?.close();
    await other?.close();
  });

  it("moves notes with its data, reads it through /fragments/, rolls back, moves and confirms", async () => {
    const page = await open(a);
    const to = `url:${b.url}`;
    try {
      await addNote(page, "Written on A");

      // A route change without the data is refused: the fragment has data at its home.
      expect(await call(page, "setRoute", NOTES, to)).toMatch(/has data at this host/);
      // A Move between different versions is refused, changing nothing.
      expect(await call(page, "move", NOTES, `url:${other.url}`)).toMatch(
        /offers version 9\.9\.9, not 0\.1\.0/,
      );
      expect(other.host?.state(NOTES)).toBeUndefined();
      expect(a.host?.state(NOTES)).toBe("enabled");

      expect(await call(page, "move", NOTES, to)).toBeUndefined();
      expect(a.host?.state(NOTES)).toBe("disabled");
      expect(a.host?.handedOver(NOTES)).toMatchObject({ to });
      expect(b.host?.state(NOTES)).toBe("enabled");
      // The same notes, through `<base>fragments/<id>/`, from the second host.
      await reload(page);
      await expect(notes(page)).resolves.toEqual(["Written on A"]);
      await addNote(page, "Written on B");
      await expect(notes(page)).resolves.toEqual(["Written on A", "Written on B"]);
      // The source keeps its data, and cannot run.
      expect(existsSync(join(dataA, "fragments", NOTES))).toBe(true);
      await expect(a.host?.enable(NOTES)).rejects.toThrow(/handed over/);

      // Rollback: the source runs again on the data it kept; the copy goes.
      expect(await call(page, "rollback", NOTES)).toBeUndefined();
      expect(a.host?.state(NOTES)).toBe("enabled");
      expect(b.host?.state(NOTES)).toBeUndefined();
      await reload(page);
      await expect(notes(page)).resolves.toEqual(["Written on A"]);

      // Moved again and confirmed: the source's data is deleted.
      expect(await call(page, "move", NOTES, to)).toBeUndefined();
      expect(await call(page, "confirm", NOTES)).toBeUndefined();
      expect(existsSync(join(dataA, "fragments", NOTES))).toBe(false);
      expect(a.host?.state(NOTES)).toBeUndefined();
      await reload(page);
      await expect(notes(page)).resolves.toEqual(["Written on A"]);
    } finally {
      await page.close();
    }
  }, 180_000);

  it("refuses a page of an origin the second host does not let in", async () => {
    const response = await fetch(new URL("_launch/host.json", b.url), {
      headers: { origin: "http://127.0.0.1:1", "sec-fetch-site": "same-site" },
    });
    expect(response.status).toBe(403);
    const preflight = await fetch(new URL(`_launch/fragments/${NOTES}/install`, b.url), {
      method: "OPTIONS",
      headers: { origin: "http://127.0.0.1:1", "access-control-request-method": "POST" },
    });
    expect(preflight.status).toBe(403);
  });
});
