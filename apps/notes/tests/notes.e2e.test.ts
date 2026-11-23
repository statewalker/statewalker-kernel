// Seam 2 (spec statewalker/statewalker-root#215): the platform end to end, through apps/notes in
// Chromium. The app is the built `dist/` (`pnpm run build`), served as static files.
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type StaticServer, serveStatic } from "../scripts/static-server.mjs";

const DIST = resolve(import.meta.dirname, "..", "dist");
const NOTES = "org.statewalker.notes";
const ADD_NOTE = `${NOTES}/add-note`;

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

interface Loaded {
  page: Page;
  /** Every script response, by URL path, in load order (repeats included). */
  scripts: string[];
  errors: string[];
}

/**
 * Open the app. An init script stands in for the React DevTools hook, which every copy of
 * react-dom registers its renderer with: the count of renderers is the count of react-dom copies.
 */
async function open(): Promise<Loaded> {
  const page = await browser.newPage();
  // Fail on the step that hangs, well before the test's own timeout.
  page.setDefaultTimeout(10_000);
  const scripts: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.request().resourceType() === "script")
      scripts.push(new URL(response.url()).pathname);
  });
  await page.addInitScript(() => {
    const renderers = new Map<number, unknown>();
    Object.defineProperty(window, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
      value: {
        renderers,
        supportsFiber: true,
        inject(renderer: unknown) {
          const id = renderers.size + 1;
          renderers.set(id, renderer);
          return id;
        },
        onScheduleFiberRoot() {},
        onCommitFiberRoot() {},
        onCommitFiberUnmount() {},
        checkDCE() {},
      },
    });
  });
  await page.goto(server.url);
  await page.getByTestId("workbench").waitFor();
  return { page, scripts, errors };
}

/** Whether the shell has linked the notes fragment's stylesheet (other fragments' are ignored). */
function notesStylesheets(page: Page): Promise<string[]> {
  return page.evaluate(
    (id) =>
      [...document.querySelectorAll<HTMLLinkElement>("link[data-fragment]")]
        .map((link) => link.dataset.fragment ?? "")
        .filter((fragment) => fragment === id),
    NOTES,
  );
}

/** The notes view's top margin: `m-4` (16px) exists only in the notes fragment's own CSS. */
function margin(page: Page): Promise<string> {
  return page.getByTestId("notes-view").evaluate((view) => getComputedStyle(view).marginTop);
}

describe("apps/notes in the browser", () => {
  it("opens the notes view in the workbench and runs its command", async () => {
    const { page, errors } = await open();
    try {
      const view = page.getByTestId("notes-view");
      await view.waitFor();
      await expect(notesStylesheets(page)).resolves.toEqual([NOTES]);
      await expect(margin(page)).resolves.toBe("16px");
      // The view sits in a dockview panel whose tab carries the view's title.
      await expect(page.locator(".dv-tab", { hasText: "Notes" }).count()).resolves.toBe(1);
      await expect(view.getByRole("listitem").count()).resolves.toBe(0);

      // Through the view: its button calls the command on the bus.
      await view.getByRole("textbox").fill("Buy milk");
      await view.getByRole("button", { name: "Add note" }).click();
      await view.getByRole("listitem").filter({ hasText: "Buy milk" }).waitFor();

      // Through the bus directly, as any fragment or the palette would.
      const result = await page.evaluate(
        (id) => window.platform.commands.call(id, { text: "Call the bank" }),
        ADD_NOTE,
      );
      expect(result).toEqual({ count: 2 });
      await view.getByRole("listitem").filter({ hasText: "Call the bank" }).waitFor();
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it("loads one copy of React, react-dom, dockview, shadcn and the client API, from the import map", async () => {
    const { page, scripts, errors } = await open();
    try {
      await page.getByTestId("notes-view").waitFor();
      const imports = await page.evaluate(
        () =>
          (
            JSON.parse(document.querySelector('script[type="importmap"]')?.textContent ?? "{}") as {
              imports?: Record<string, string>;
            }
          ).imports ?? {},
      );
      for (const specifier of [
        "react",
        "react/jsx-runtime",
        "react-dom",
        "react-dom/client",
        "dockview-react",
        "@statewalker/ui.view.shadcn",
        "@statewalker/client.core",
      ]) {
        expect(imports[specifier], specifier).toBeDefined();
      }
      // Each shared module is fetched once, and so is every script.
      for (const url of Object.values(imports)) {
        const path = new URL(url, server.url).pathname;
        expect(
          scripts.filter((s) => s === path),
          path,
        ).toHaveLength(1);
      }
      expect(new Set(scripts).size).toBe(scripts.length);

      // One react-dom registered a renderer.
      const renderers = await page.evaluate(
        () =>
          (
            window as unknown as {
              __REACT_DEVTOOLS_GLOBAL_HOOK__: { renderers: Map<number, unknown> };
            }
          ).__REACT_DEVTOOLS_GLOBAL_HOOK__.renderers.size,
      );
      expect(renderers).toBe(1);

      // The notes fragment's bundle imports the shared modules by bare specifier: every import
      // it makes is either relative to it or a key of the import map, so nothing is bundled twice.
      const bundlePath = `/fragments/${NOTES}/client/index.js`;
      expect(scripts).toContain(bundlePath);
      const bundle = await (await fetch(new URL(bundlePath, server.url))).text();
      const specifiers = [...bundle.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)].map(
        (m) => m[1] as string,
      );
      expect(specifiers).toEqual(
        expect.arrayContaining([
          "react",
          "@statewalker/ui.view.shadcn",
          "@statewalker/client.core",
        ]),
      );
      for (const specifier of specifiers) {
        if (specifier.startsWith(".")) continue;
        expect(Object.keys(imports), specifier).toContain(specifier);
      }
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it("disabling notes closes its view and removes its command", async () => {
    const { page, errors } = await open();
    try {
      await page.getByTestId("notes-view").waitFor();
      const before = await page.evaluate(() => window.platform.commands.list().map((c) => c.id));
      expect(before).toContain(ADD_NOTE);

      await page.evaluate((id) => window.platform.kernel.disable(id), NOTES);

      await page.getByTestId("notes-view").waitFor({ state: "detached" });
      await expect(page.locator(".dv-tab", { hasText: "Notes" }).count()).resolves.toBe(0);
      const after = await page.evaluate(() => window.platform.commands.list().map((c) => c.id));
      expect(after).not.toContain(ADD_NOTE);
      const failure = await page.evaluate(
        (id) =>
          window.platform.commands.call(id, { text: "x" }).then(
            () => "called",
            (error: { kind?: string }) => error.kind,
          ),
        ADD_NOTE,
      );
      expect(failure).toBe("unknown-command");
      // The workbench is still there, empty, and the fragment's stylesheet is gone.
      await page.getByTestId("workbench").waitFor();
      await expect(notesStylesheets(page)).resolves.toEqual([]);
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });

  it("re-enabling notes brings back its command and its view, styled", async () => {
    const { page, errors } = await open();
    try {
      await page.getByTestId("notes-view").waitFor();
      await page.evaluate((id) => window.platform.kernel.disable(id), NOTES);
      await page.getByTestId("notes-view").waitFor({ state: "detached" });

      await page.evaluate((id) => window.platform.kernel.enable(id), NOTES);
      await page.waitForFunction((id) => window.platform.commands.get(id) !== undefined, ADD_NOTE);
      await page.evaluate((id) => window.platform.workbench.open(`${id}/notes`), NOTES);
      await page.getByTestId("notes-view").waitFor();

      // Its client aspect is active again: its prebuilt CSS is linked and applies to the view.
      await expect(notesStylesheets(page)).resolves.toEqual([NOTES]);
      await expect(margin(page)).resolves.toBe("16px");
      await expect(
        page.evaluate((id) => window.platform.commands.call(id, { text: "Back" }), ADD_NOTE),
      ).resolves.toMatchObject({ count: expect.any(Number) });
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  });
});
