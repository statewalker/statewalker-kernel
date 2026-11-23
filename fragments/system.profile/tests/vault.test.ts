// Seam 1: the system.profile vault through its public interface (statewalker-root#264, spec
// statewalker-root#215 user stories 31 and 32): created and unlocked with a password, secrets put
// and read by namespaced name, the record in the profile's storage never holding a secret in clear.
import { describe, expect, it } from "vitest";
import {
  createMemoryAuthenticator,
  createMemoryKeyStore,
  createMemoryStorage,
  createSystemProfile,
  PasskeyProblem,
  VAULT_VERSION,
  VaultUnavailableError,
} from "../src/index.js";

// Few PBKDF2 iterations keep the tests fast; the default is 600 000.
const ITERATIONS = 1000;

type Storage = ReturnType<typeof createMemoryStorage>;
type Keys = ReturnType<typeof createMemoryKeyStore>;

/** A system.profile over `storage` (one device's) with its vault, as a new start would make it. */
const start = (
  storage: Storage,
  keys: Keys,
  authenticator?: ReturnType<typeof createMemoryAuthenticator>,
) =>
  createSystemProfile({
    storage,
    prefix: "app:",
    vault: { keys, iterations: ITERATIONS, ...(authenticator ? { authenticator } : {}) },
  }).vault;

/** Every stored text of the device: the profile's storage. */
function storedTexts(storage: Storage): string {
  let all = "";
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i) as string;
    all += `${key}=${storage.getItem(key)}\n`;
  }
  return all;
}

/** A device with a vault holding one secret, locked again. */
async function deviceWithVault() {
  const storage = createMemoryStorage();
  const keys = createMemoryKeyStore();
  const vault = start(storage, keys);
  await vault.load();
  await vault.create("correct horse", { remember: false });
  await vault.secrets("org.example.mail").put("token", "s3cr3t-value");
  vault.lock();
  return { storage, keys };
}

const record = (storage: Storage) => JSON.parse(storage.getItem("app:vault") ?? "null");

describe("the vault", () => {
  it("is created with a password, keeps secrets by namespaced name, and unlocks again", async () => {
    const storage = createMemoryStorage();
    const keys = createMemoryKeyStore();
    const first = start(storage, keys);
    await expect(first.load()).resolves.toMatchObject({ status: "absent" });
    await first.create("correct horse", { remember: false });
    expect(first.state().status).toBe("unlocked");
    await first.secrets("org.example.mail").put("token", "s3cr3t-value");

    const later = start(storage, keys);
    await expect(later.load()).resolves.toMatchObject({ status: "locked" });
    await expect(later.secrets("org.example.mail").get("token")).rejects.toThrow(/locked/i);
    await expect(later.unlock("correct horse", { remember: false })).resolves.toBe(true);
    await expect(later.secrets("org.example.mail").get("token")).resolves.toBe("s3cr3t-value");
    await expect(later.secrets("org.example.mail").names()).resolves.toEqual(["token"]);
    // Namespaces do not see each other's secrets.
    await expect(later.secrets("org.example.other").get("token")).resolves.toBeUndefined();
  });

  it("stores no secret and no password in clear: the record holds only ciphertext", async () => {
    const { storage } = await deviceWithVault();
    const stored = storedTexts(storage);
    expect(stored).not.toContain("s3cr3t-value");
    expect(stored).not.toContain("correct horse");
    expect(stored).not.toContain("token"); // the secrets' names are sealed too
    expect(Object.keys(record(storage)).sort()).toEqual([
      "data",
      "id",
      "passkeys",
      "password",
      "version",
    ]);
    expect(record(storage)).toMatchObject({
      version: VAULT_VERSION,
      password: { kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS } },
    });
  });

  it("refuses a wrong password, and stays locked", async () => {
    const { storage, keys } = await deviceWithVault();
    const vault = start(storage, keys);
    await vault.load();
    await expect(vault.unlock("wrong horse")).resolves.toBe(false);
    expect(vault.state().status).toBe("locked");
    await expect(vault.secrets("org.example.mail").get("token")).rejects.toThrow(/locked/i);
  });

  it("reports tampered data (an AES-GCM authentication failure) as corrupt, and writes nothing", async () => {
    const { storage, keys } = await deviceWithVault();
    const tampered = record(storage);
    const bytes = Uint8Array.from(atob(tampered.data.data), (c) => c.charCodeAt(0));
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    tampered.data.data = btoa(String.fromCharCode(...bytes));
    const text = JSON.stringify(tampered);
    storage.setItem("app:vault", text);

    const vault = start(storage, keys);
    await expect(vault.load()).resolves.toMatchObject({ status: "locked" });
    await expect(vault.unlock("correct horse")).rejects.toBeInstanceOf(VaultUnavailableError);
    expect(vault.state()).toMatchObject({ status: "corrupt", reason: { code: "corrupt" } });
    await expect(vault.secrets("org.example.mail").put("token", "x")).rejects.toThrow();
    expect(storage.getItem("app:vault")).toBe(text);
  });

  it("does not unlock with a wrap moved from another vault (wraps are bound to their vault)", async () => {
    const a = await deviceWithVault();
    const b = await deviceWithVault();
    const mixed = { ...record(b.storage), password: record(a.storage).password };
    b.storage.setItem("app:vault", JSON.stringify(mixed));
    const vault = start(b.storage, b.keys);
    await vault.load();
    await expect(vault.unlock("correct horse")).resolves.toBe(false);
  });

  it.each([
    ["text that is not JSON", "{not json", "corrupt"],
    ["a record missing its fields", JSON.stringify({ version: VAULT_VERSION, id: "x" }), "corrupt"],
    ["a record without a version", JSON.stringify({ id: "abcdefghijklmnopqrstuv" }), "corrupt"],
    ["a record of an unknown version", null, "unknown-version"],
  ])("stays locked on %s, says why, and never writes over it", async (_, given, code) => {
    const { storage, keys } = await deviceWithVault();
    const text = given ?? JSON.stringify({ ...record(storage), version: VAULT_VERSION + 1 });
    storage.setItem("app:vault", text);

    const vault = start(storage, keys);
    const state = await vault.load();
    expect(state.status).toBe("corrupt");
    expect(state.reason?.code).toBe(code);
    expect(state.reason?.message).toMatch(/vault/);
    await expect(vault.unlock("correct horse")).rejects.toBeInstanceOf(VaultUnavailableError);
    await expect(vault.create("another horse")).rejects.toBeInstanceOf(VaultUnavailableError);
    await expect(vault.secrets("org.example.mail").put("token", "x")).rejects.toThrow();
    expect(vault.state().status).toBe("corrupt");
    expect(storage.getItem("app:vault")).toBe(text);
  });

  it("refuses to create a vault over an existing one", async () => {
    const { storage, keys } = await deviceWithVault();
    const text = storage.getItem("app:vault");
    const vault = start(storage, keys);
    await vault.load();
    await expect(vault.create("another horse")).rejects.toBeInstanceOf(VaultUnavailableError);
    expect(storage.getItem("app:vault")).toBe(text);
  });

  it("remembers its key on this device: the next start unlocks silently, until forgotten", async () => {
    const storage = createMemoryStorage();
    const keys = createMemoryKeyStore();
    const vault = start(storage, keys);
    await vault.load();
    await vault.create("correct horse", { remember: true });
    await vault.secrets("org.example.mail").put("token", "s3cr3t-value");
    expect(vault.state().remembered).toBe(true);

    const later = start(storage, keys);
    await expect(later.load()).resolves.toMatchObject({ status: "unlocked", remembered: true });
    await expect(later.secrets("org.example.mail").get("token")).resolves.toBe("s3cr3t-value");
    // The remembered key is the data key itself, and cannot be exported.
    const key = await keys.get("remembered");
    expect(key?.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key as CryptoKey)).rejects.toThrow();

    await later.forget();
    later.lock();
    expect(later.state()).toMatchObject({ status: "locked", remembered: false });
    expect(keys.size).toBe(0);
    await expect(start(storage, keys).load()).resolves.toMatchObject({ status: "locked" });
  });

  it("unlocks with a passkey (WebAuthn PRF) added with the password", async () => {
    const storage = createMemoryStorage();
    const keys = createMemoryKeyStore();
    const auth = createMemoryAuthenticator();
    const vault = start(storage, keys, auth);
    await vault.load();
    await vault.create("correct horse");
    await vault.secrets("org.example.mail").put("token", "s3cr3t-value");
    await expect(vault.addPasskey("wrong horse")).resolves.toBe(false);
    expect(auth.credentials).toEqual([]); // a wrong password never reaches the prompt
    await expect(vault.addPasskey("correct horse")).resolves.toBe(true);
    expect(vault.state().passkeys).toEqual([
      { credentialId: auth.credentials[0]?.id, createdAt: expect.any(String) },
    ]);
    expect(storedTexts(storage)).not.toContain("s3cr3t-value");

    const later = start(storage, keys, auth);
    await later.load();
    await expect(later.unlockWithPasskey()).resolves.toBe(true);
    await expect(later.secrets("org.example.mail").get("token")).resolves.toBe("s3cr3t-value");

    // A dismissed prompt changes nothing.
    later.lock();
    auth.dismissNext = true;
    await expect(later.unlockWithPasskey()).rejects.toBeInstanceOf(PasskeyProblem);
    expect(later.state().status).toBe("locked");

    // A removed passkey unlocks nothing.
    await later.unlock("correct horse");
    await later.removePasskey(auth.credentials[0]?.id as string);
    later.lock();
    await expect(later.unlockWithPasskey()).rejects.toBeInstanceOf(PasskeyProblem);
    expect(later.state().status).toBe("locked");
  });

  it("refuses names outside a fragment's namespace", () => {
    const vault = start(createMemoryStorage(), createMemoryKeyStore());
    expect(() => vault.secrets("../x")).toThrow(TypeError);
    expect(() => vault.secrets("nodots")).toThrow(TypeError);
  });
});
