// Seam 2 (statewalker-root#264; spec statewalker/statewalker-root#215, user stories 31 and 32,
// acceptance criterion 5): system.profile's vault through apps/notes in Chromium. The vault view
// creates and unlocks it with a password, or with a passkey (Chromium's virtual authenticator with
// the PRF extension, through the DevTools protocol); a key remembered on this device unlocks it
// after a reload until forgotten; an unreadable record or one of an unknown version stays locked,
// says why, and keeps its bytes; and nothing in localStorage or IndexedDB holds a secret in clear.
// Each test opens a new browser context (a fresh profile). The app is `dist/`, served on
// `localhost` (WebAuthn refuses IP addresses as relying parties).
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import application from "../application.json" with { type: "json" };
import { type StaticServer, serveStatic } from "../scripts/static-server.mjs";

const DIST = resolve(import.meta.dirname, "..", "dist");
const RECORD_KEY = `${application.id}:vault`;
const KEYS_DB = `${application.id}:vault`;
const PASSWORD = "correct horse battery";
const SECRET = "sk-test-0123456789abcdef";
const MAIL = "org.example.mail";

let server: StaticServer;
let browser: Browser;
let url: string;

beforeAll(async () => {
  if (!existsSync(join(DIST, "index.html"))) {
    throw new Error(`no build at ${DIST}: run \`pnpm run build\` in apps/notes first`);
  }
  server = await serveStatic(DIST);
  url = server.url.replace("127.0.0.1", "localhost");
  browser = await chromium.launch();
});

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

/** Run `body` on the app in a new context (a fresh profile); fails on any page error. */
async function withPage(body: (page: Page, context: BrowserContext) => Promise<void>) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // A fragment without a stylesheet (the test's own) 404s its index.css, harmlessly.
    if (message.type() === "error" && !message.text().includes("404")) errors.push(message.text());
  });
  try {
    await page.goto(url);
    await page.getByTestId("workbench").waitFor();
    await body(page, context);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
}

const vaultView = (page: Page) => page.getByTestId("vault-view");

async function openVault(page: Page) {
  await page.getByTestId("activitybar").getByRole("button", { name: "Vault" }).click();
  await vaultView(page).waitFor();
}

async function reload(page: Page) {
  await page.reload();
  await page.getByTestId("workbench").waitFor();
  await openVault(page);
}

const status = (page: Page) => vaultView(page).getAttribute("data-status");

async function waitForStatus(page: Page, expected: string) {
  await page.locator(`[data-testid="vault-view"][data-status="${expected}"]`).waitFor();
}

/** Create the vault in the view (PBKDF2 at its default: 600 000 iterations). */
async function createVault(page: Page, { remember = false } = {}) {
  await openVault(page);
  await waitForStatus(page, "absent");
  await vaultView(page).getByLabel("Password", { exact: true }).fill(PASSWORD);
  await vaultView(page).getByLabel("Password again").fill(PASSWORD);
  if (remember) await vaultView(page).getByLabel("Remember on this device").check();
  await vaultView(page).getByRole("button", { name: "Create the vault" }).click();
  await waitForStatus(page, "unlocked");
}

const putSecret = (page: Page) =>
  page.evaluate(
    ([ns, value]) => window.platform.vault.secrets(ns as string).put("api-key", value as string),
    [MAIL, SECRET],
  );

const getSecret = (page: Page) =>
  page.evaluate((ns) => window.platform.vault.secrets(ns).get("api-key"), MAIL);

/**
 * Everything the device keeps for the page: every localStorage item, and every IndexedDB value
 * (a `CryptoKey` described by its type, algorithm and whether it can be exported).
 */
const deviceStorage = (page: Page) =>
  page.evaluate(async () => {
    const items: Record<string, string | null> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) as string;
      items[key] = localStorage.getItem(key);
    }
    const databases: Record<string, unknown[]> = {};
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue;
      const db = await new Promise<IDBDatabase>((done, fail) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => done(request.result);
        request.onerror = () => fail(request.error);
      });
      const values: unknown[] = [];
      for (const store of db.objectStoreNames) {
        const all = await new Promise<unknown[]>((done, fail) => {
          const request = db.transaction(store).objectStore(store).getAll();
          request.onsuccess = () => done(request.result);
          request.onerror = () => fail(request.error);
        });
        for (const value of all) {
          values.push(
            value instanceof CryptoKey
              ? {
                  cryptoKey: true,
                  type: value.type,
                  extractable: value.extractable,
                  algorithm: value.algorithm.name,
                }
              : value,
          );
        }
      }
      db.close();
      databases[name] = values;
    }
    return { items, databases, text: JSON.stringify({ items, databases }) };
  });

describe("the vault", () => {
  it("is created and unlocked with a password, and stores nothing in clear", async () => {
    await withPage(async (page) => {
      await createVault(page);
      await putSecret(page);
      await expect(getSecret(page)).resolves.toBe(SECRET);

      const stored = await deviceStorage(page);
      expect(stored.items[RECORD_KEY]).toBeTruthy();
      expect(stored.text).not.toContain(SECRET);
      expect(stored.text).not.toContain(PASSWORD);
      expect(stored.text).not.toContain("api-key");
      expect(JSON.parse(stored.items[RECORD_KEY] as string)).toMatchObject({
        version: 1,
        password: { kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 600_000 } },
      });

      // Not remembered: a reload locks it.
      await reload(page);
      await waitForStatus(page, "locked");
      await expect(getSecret(page)).rejects.toThrow(/locked/i);
      await vaultView(page).getByLabel("Password", { exact: true }).fill("wrong horse battery");
      await vaultView(page).getByRole("button", { name: "Unlock" }).click();
      await expect(vaultView(page).getByTestId("vault-problem").innerText()).resolves.toBe(
        "Wrong password.",
      );
      await expect(status(page)).resolves.toBe("locked");
      await vaultView(page).getByLabel("Password", { exact: true }).fill(PASSWORD);
      await vaultView(page).getByRole("button", { name: "Unlock" }).click();
      await waitForStatus(page, "unlocked");
      await expect(getSecret(page)).resolves.toBe(SECRET);

      await vaultView(page).getByRole("button", { name: "Lock" }).click();
      await waitForStatus(page, "locked");
      await expect(getSecret(page)).rejects.toThrow(/locked/i);
    });
  });

  it("remembers its key on this device over a reload, non-extractable, until forgotten", async () => {
    await withPage(async (page) => {
      await createVault(page, { remember: true });
      await putSecret(page);

      await reload(page);
      await waitForStatus(page, "unlocked");
      await expect(getSecret(page)).resolves.toBe(SECRET);
      const stored = await deviceStorage(page);
      expect(stored.databases[KEYS_DB]).toEqual([
        { cryptoKey: true, type: "secret", extractable: false, algorithm: "AES-GCM" },
      ]);
      expect(stored.text).not.toContain(SECRET);

      const forget = vaultView(page).getByRole("button", { name: "Forget on this device" });
      await forget.click();
      await forget.waitFor({ state: "detached" });
      await expect((await deviceStorage(page)).databases[KEYS_DB]).toEqual([]);
      await reload(page);
      await waitForStatus(page, "locked");
      await expect(getSecret(page)).rejects.toThrow(/locked/i);
    });
  });

  it("unlocks with a passkey (WebAuthn PRF, a virtual authenticator)", async () => {
    await withPage(async (page, context) => {
      const cdp = await context.newCDPSession(page);
      await cdp.send("WebAuthn.enable");
      const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
        options: {
          protocol: "ctap2",
          transport: "internal",
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          hasPrf: true,
          automaticPresenceSimulation: true,
        },
      });
      await createVault(page);
      await putSecret(page);
      const passkeys = vaultView(page).getByTestId("vault-passkeys");
      await passkeys.getByLabel("Password, to add a passkey").fill(PASSWORD);
      await passkeys.getByRole("button", { name: "Add a passkey" }).click();
      await passkeys.getByRole("button", { name: "Remove" }).waitFor();
      // One discoverable credential, for the vault (its user handle is the vault's id).
      const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
      expect(credentials).toHaveLength(1);
      expect((await deviceStorage(page)).text).not.toContain(SECRET);

      await reload(page);
      await waitForStatus(page, "locked");
      await vaultView(page).getByRole("button", { name: "Unlock with a passkey" }).click();
      await waitForStatus(page, "unlocked");
      await expect(getSecret(page)).resolves.toBe(SECRET);
    });
  });

  it.each([
    ["an unreadable record", "unreadable", "corrupt", /not readable/],
    ["a record of an unknown version", "newer", "unknown-version", /version 2/],
  ])("stays locked on %s, says why, and keeps its bytes", async (_, damage, code, message) => {
    await withPage(async (page) => {
      await createVault(page, { remember: true });
      await putSecret(page);
      const text = await page.evaluate(
        ([key, how]) => {
          const record = localStorage.getItem(key as string) as string;
          const next =
            how === "newer" ? JSON.stringify({ ...JSON.parse(record), version: 2 }) : "{not json";
          localStorage.setItem(key as string, next);
          return next;
        },
        [RECORD_KEY, damage],
      );

      await reload(page);
      await waitForStatus(page, "corrupt");
      await expect(page.evaluate(() => window.platform.vault.state().reason?.code)).resolves.toBe(
        code,
      );
      await expect(vaultView(page).getByTestId("vault-reason").innerText()).resolves.toMatch(
        message,
      );
      // Nothing in the view would write it, and the model refuses to.
      await expect(
        vaultView(page)
          .getByRole("button", { name: /Create|Unlock/ })
          .count(),
      ).resolves.toBe(0);
      await expect(
        page.evaluate(
          (p) => window.platform.vault.unlock(p).then(String, (e: Error) => e.name),
          PASSWORD,
        ),
      ).resolves.toBe("VaultUnavailableError");
      await expect(
        page.evaluate(
          (p) => window.platform.vault.create(p).then(String, (e: Error) => e.name),
          PASSWORD,
        ),
      ).resolves.toBe("VaultUnavailableError");
      await expect(getSecret(page)).rejects.toThrow();

      await reload(page);
      await waitForStatus(page, "corrupt");
      await expect(page.evaluate((key) => localStorage.getItem(key), RECORD_KEY)).resolves.toBe(
        text,
      );
    });
  });
});
