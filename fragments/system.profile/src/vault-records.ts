// The vault's record and its crypto, after sandclaw's `vault-records.ts` (file-mounts.core): a
// random AES-GCM data key seals the secrets; it is wrapped by a key derived from the password
// (PBKDF2-SHA-256) and by one key per passkey (HKDF-SHA-256 over the authenticator's PRF secret).
// Web Crypto only. Internal: src/index.ts exports only the version and the parse result's types.

/** The record format this code reads and writes. Any other version is never read or rewritten. */
export const VAULT_VERSION = 1;

export interface Wrapped {
  readonly iv: string;
  readonly wrappedKey: string;
}
export interface PasswordWrap extends Wrapped {
  readonly kdf: {
    readonly name: "PBKDF2";
    readonly hash: "SHA-256";
    readonly iterations: number;
    readonly salt: string;
  };
}
export interface PasskeyWrap extends Wrapped {
  readonly credentialId: string;
  readonly salt: string;
  readonly createdAt: string;
}
export interface Sealed {
  readonly iv: string;
  readonly data: string;
}
/** The record, as JSON in the profile's storage: everything secret is ciphertext. */
export interface VaultRecord {
  readonly version: typeof VAULT_VERSION;
  readonly id: string;
  readonly password: PasswordWrap;
  readonly passkeys: readonly PasskeyWrap[];
  readonly data: Sealed;
}
/** What the data key seals: the secrets by full name (`<namespace>/<name>`). */
export interface VaultData {
  readonly secrets: Readonly<Record<string, string>>;
}

/** Bounds a record must keep (a crafted record cannot make an unlock run for hours). */
export const MAX_ITERATIONS = 10_000_000;
export const MAX_PASSKEYS = 32;
const MAX_CREDENTIAL_ID = 1024;

export const utf8 = (text: string) => new TextEncoder().encode(text);
export const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  let text = "";
  for (const b of bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) {
    text += String.fromCharCode(b);
  }
  return btoa(text);
}
export const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
export const toBase64Url = (bytes: ArrayBuffer | Uint8Array) =>
  toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const fromBase64Url = (text: string) =>
  fromBase64(
    text
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(text.length / 4) * 4, "="),
  );

/**
 * The additional data each AES-GCM operation is bound to: the format version, the vault's id and
 * the purpose, so a wrap or the data cannot be moved to another vault, purpose or version.
 */
const aad = (id: string, purpose: string) =>
  utf8(`statewalker.vault:${VAULT_VERSION}:${id}:${purpose}`);
const PASSWORD = "password";
const DATA = "data";
const passkeyPurpose = (credentialId: string) => `passkey:${credentialId}`;

async function passwordKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", utf8(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/** The key a passkey wrap is made with: HKDF over the authenticator's PRF secret. */
async function passkeyKey(secret: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new Uint8Array(secret), "HKDF", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(salt),
      info: utf8("statewalker.vault passkey"),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

async function wrap(dataKey: CryptoKey, key: CryptoKey, additionalData: Uint8Array<ArrayBuffer>) {
  const iv = random(12);
  const wrapped = await crypto.subtle.wrapKey("raw", dataKey, key, {
    name: "AES-GCM",
    iv,
    additionalData,
  });
  return { iv: toBase64(iv), wrappedKey: toBase64(wrapped) };
}

function unwrap(
  wrapped: Wrapped,
  key: CryptoKey,
  additionalData: Uint8Array<ArrayBuffer>,
  extractable: boolean,
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    "raw",
    fromBase64(wrapped.wrappedKey),
    key,
    { name: "AES-GCM", iv: fromBase64(wrapped.iv), additionalData },
    { name: "AES-GCM", length: 256 },
    extractable,
    ["encrypt", "decrypt"],
  );
}

/** A new data key: extractable only while it is being wrapped for the first time. */
export const newDataKey = () =>
  crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);

export async function newPasswordWrap(
  dataKey: CryptoKey,
  id: string,
  password: string,
  iterations: number,
): Promise<PasswordWrap> {
  const salt = random(16);
  const key = await passwordKey(password, salt, iterations);
  return {
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: toBase64(salt) },
    ...(await wrap(dataKey, key, aad(id, PASSWORD))),
  };
}

/** The data key the password unwraps; rejects (an AES-GCM failure) for a wrong password. */
export async function unwrapWithPassword(
  record: VaultRecord,
  password: string,
  extractable: boolean,
): Promise<CryptoKey> {
  const { kdf } = record.password;
  const key = await passwordKey(password, fromBase64(kdf.salt), kdf.iterations);
  return unwrap(record.password, key, aad(record.id, PASSWORD), extractable);
}

export async function newPasskeyWrap(
  dataKey: CryptoKey,
  id: string,
  credentialId: string,
  secret: Uint8Array,
): Promise<PasskeyWrap> {
  const salt = random(16);
  const key = await passkeyKey(secret, salt);
  return {
    credentialId,
    salt: toBase64(salt),
    createdAt: new Date().toISOString(),
    ...(await wrap(dataKey, key, aad(id, passkeyPurpose(credentialId)))),
  };
}

/** The data key a passkey's PRF secret unwraps (non-extractable). */
export async function unwrapWithPasskey(
  record: VaultRecord,
  passkey: PasskeyWrap,
  secret: Uint8Array,
): Promise<CryptoKey> {
  const key = await passkeyKey(secret, fromBase64(passkey.salt));
  return unwrap(passkey, key, aad(record.id, passkeyPurpose(passkey.credentialId)), false);
}

export async function seal(dataKey: CryptoKey, id: string, data: VaultData): Promise<Sealed> {
  const iv = random(12);
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad(id, DATA) },
    dataKey,
    utf8(JSON.stringify(data)),
  );
  return { iv: toBase64(iv), data: toBase64(sealed) };
}

/** The sealed data; rejects on an AES-GCM authentication failure or data of the wrong shape. */
export async function unseal(dataKey: CryptoKey, record: VaultRecord): Promise<VaultData> {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(record.data.iv), additionalData: aad(record.id, DATA) },
    dataKey,
    fromBase64(record.data.data),
  );
  const data = JSON.parse(new TextDecoder().decode(plain)) as unknown;
  const secrets = (data as { secrets?: unknown } | null)?.secrets;
  if (!isPlainObject(secrets) || !Object.values(secrets).every((v) => typeof v === "string")) {
    throw new TypeError("vault: sealed data of an unknown shape");
  }
  return { secrets: { ...(secrets as Record<string, string>) } };
}

/** What a stored record reads as: a record, nothing, or why it cannot be read. */
export type ParsedRecord =
  | { readonly kind: "absent" }
  | { readonly kind: "record"; readonly record: VaultRecord }
  | { readonly kind: "corrupt"; readonly message: string }
  | { readonly kind: "unknown-version"; readonly version: unknown; readonly message: string };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Base64 of exactly `bytes` bytes (any length when undefined, at least one byte). */
function isBase64(value: unknown, bytes?: number): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  try {
    const length = fromBase64(value).length;
    return bytes === undefined ? length > 0 : length === bytes;
  } catch {
    return false;
  }
}

// A 256-bit key wrapped with AES-GCM: 32 bytes and the 16-byte tag.
const isWrapped = (value: Record<string, unknown>) =>
  isBase64(value.iv, 12) && isBase64(value.wrappedKey, 48);

function isPasswordWrap(value: unknown): value is PasswordWrap {
  if (!isPlainObject(value) || !isWrapped(value) || !isPlainObject(value.kdf)) return false;
  const { name, hash, iterations, salt } = value.kdf;
  return (
    name === "PBKDF2" &&
    hash === "SHA-256" &&
    Number.isInteger(iterations) &&
    (iterations as number) >= 1 &&
    (iterations as number) <= MAX_ITERATIONS &&
    isBase64(salt, 16)
  );
}

function isPasskeyWrap(value: unknown): value is PasskeyWrap {
  return (
    isPlainObject(value) &&
    isWrapped(value) &&
    typeof value.credentialId === "string" &&
    /^[A-Za-z0-9_-]+$/.test(value.credentialId) &&
    value.credentialId.length <= MAX_CREDENTIAL_ID &&
    isBase64(value.salt, 16) &&
    typeof value.createdAt === "string" &&
    value.createdAt.length <= 64
  );
}

/**
 * Read a stored record strictly. Text that is not JSON, a record of this version missing or
 * malforming any field, or an unexpected shape is corrupt; a record naming another version is of
 * an unknown version. Neither is ever rewritten by the vault.
 */
export function parseRecord(text: string | null | undefined): ParsedRecord {
  if (text === null || text === undefined) return { kind: "absent" };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { kind: "corrupt", message: "The vault's record is not readable (not JSON)." };
  }
  if (!isPlainObject(value)) {
    return { kind: "corrupt", message: "The vault's record is not readable (not a record)." };
  }
  if (value.version !== VAULT_VERSION) {
    if (Number.isInteger(value.version)) {
      return {
        kind: "unknown-version",
        version: value.version,
        message: `The vault's record has version ${String(value.version)}, which this version of the application cannot read (it reads version ${VAULT_VERSION}).`,
      };
    }
    return { kind: "corrupt", message: "The vault's record is not readable (no version)." };
  }
  const passkeys = value.passkeys;
  const ok =
    typeof value.id === "string" &&
    /^[A-Za-z0-9_-]{16,64}$/.test(value.id) &&
    isPasswordWrap(value.password) &&
    Array.isArray(passkeys) &&
    passkeys.length <= MAX_PASSKEYS &&
    passkeys.every(isPasskeyWrap) &&
    new Set(passkeys.map((p: PasskeyWrap) => p.credentialId)).size === passkeys.length &&
    isPlainObject(value.data) &&
    isBase64(value.data.iv, 12) &&
    isBase64(value.data.data);
  if (!ok) {
    return { kind: "corrupt", message: "The vault's record is not readable (malformed fields)." };
  }
  return { kind: "record", record: value as unknown as VaultRecord };
}

const queues = new Map<string, Promise<unknown>>();

/** One writer at a time per name: in this tab through a queue, across tabs through Web Locks. */
export function exclusive<T>(name: string, action: () => Promise<T>): Promise<T> {
  const locks = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
  const run = () => (locks ? locks.request(name, () => action()) : action());
  const result = (queues.get(name) ?? Promise.resolve()).then(run, run);
  queues.set(
    name,
    result.catch(() => undefined),
  );
  return result;
}
