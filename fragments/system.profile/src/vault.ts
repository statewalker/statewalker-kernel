// The vault: secrets encrypted at rest in the profile's storage, after sandclaw's `SecretVault`
// (file-mounts.core). A random AES-GCM data key seals them; it is wrapped by a key derived from the
// password (PBKDF2) and by one key per passkey (WebAuthn PRF). "Remember on this device" keeps the
// unwrapped data key itself, non-extractable, in a key store (IndexedDB), for a silent unlock.
// Every change re-reads the record under one lock (Web Locks across tabs), and a record that does
// not parse, or of another version, leaves the vault unavailable and is never written over.
import { isFragmentId } from "@statewalker/kernel.core";
import type { VaultKeyStore } from "./key-store.js";
import { PASSKEY_MESSAGES, type PasskeyAuthenticator, PasskeyProblem } from "./passkeys.js";
import {
  exclusive,
  newDataKey,
  newPasskeyWrap,
  newPasswordWrap,
  parseRecord,
  random,
  seal,
  toBase64Url,
  unseal,
  unwrapWithPasskey,
  unwrapWithPassword,
  VAULT_VERSION,
  type VaultData,
  type VaultRecord,
} from "./vault-records.js";

/** Where the vault's record is kept: one text, read and written at once (Web Storage). */
export interface VaultRecordStore {
  read(): string | null;
  write(text: string): void;
}

/**
 * - `absent`: no vault yet; `create` makes one.
 * - `locked`: a vault this code reads; its secrets need an unlock.
 * - `unlocked`: its secrets can be read and written until `lock`.
 * - `corrupt`: its record cannot be read (`reason` says why); it stays locked and is never written.
 */
export type VaultStatus = "absent" | "locked" | "unlocked" | "corrupt";

/** Why the vault is unavailable. Never holds a secret. */
export interface VaultProblem {
  /** `corrupt`: unreadable, malformed, or failing its integrity check; `unknown-version`: newer. */
  readonly code: "corrupt" | "unknown-version";
  readonly message: string;
}

/** The vault's public state: never a secret, a key or a secret's name. */
export interface VaultState {
  readonly status: VaultStatus;
  readonly reason?: VaultProblem;
  /** Whether a data key is remembered on this device (a silent unlock at the next start). */
  readonly remembered: boolean;
  /** The passkeys that unlock it (readable while locked). */
  readonly passkeys: readonly { readonly credentialId: string; readonly createdAt: string }[];
}

/** A namespace's secrets: system code's, or (statewalker-root#265) a fragment's declared ones. */
export interface SecretScope {
  readonly namespace: string;
  /** The value, `undefined` when none. Throws `VaultLockedError` while locked. */
  get(name: string): Promise<string | undefined>;
  put(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
  /** The names of this namespace's secrets (they are sealed too: needs an unlock). */
  names(): Promise<string[]>;
}

export interface Vault {
  state(): VaultState;
  /** Called on every state change; returns the unsubscribe. */
  observe(listener: (state: VaultState) => void): () => void;
  /** Read the record: a remembered key unlocks silently, otherwise the vault is locked. */
  load(): Promise<VaultState>;
  /** Make a new vault (refused when one exists or is unreadable), unlocked. */
  create(password: string, options?: { readonly remember?: boolean }): Promise<void>;
  /** False: a wrong password. Throws `VaultUnavailableError` for an unreadable vault. */
  unlock(password: string, options?: { readonly remember?: boolean }): Promise<boolean>;
  /** False: the passkey does not unlock this vault. Throws `PasskeyProblem` when it did not answer. */
  unlockWithPasskey(options?: { readonly remember?: boolean }): Promise<boolean>;
  /** Whether this browser can unlock with a passkey. */
  passkeysAvailable(): Promise<boolean>;
  /** Add a passkey; the password is checked first (false: wrong), then the browser asks. */
  addPasskey(password: string, options?: { readonly name?: string }): Promise<boolean>;
  removePasskey(credentialId: string): Promise<void>;
  /** Drop the data key from memory: the secrets need an unlock again. */
  lock(): void;
  /** Drop the data key remembered on this device (the vault stays as it is). */
  forget(): Promise<void>;
  /** The secrets of `namespace` (a fragment id: `org.example.mail`, `system.ai`). */
  secrets(namespace: string): SecretScope;
}

export class VaultLockedError extends Error {
  constructor() {
    super("The vault is locked: unlock it to use secrets.");
    this.name = "VaultLockedError";
  }
}

/** The vault cannot be used: absent, unreadable or of an unknown version (`reason`). */
export class VaultUnavailableError extends Error {
  readonly reason?: VaultProblem;
  constructor(message: string, reason?: VaultProblem) {
    super(message);
    this.name = "VaultUnavailableError";
    if (reason) this.reason = reason;
  }
}

export interface VaultOptions {
  readonly records: VaultRecordStore;
  /** Where a remembered key is kept: IndexedDB in a browser; memory by default. */
  readonly keys: VaultKeyStore;
  /** The browser's passkeys (WebAuthn PRF); without one, passkeys are unavailable. */
  readonly authenticator?: PasskeyAuthenticator;
  /** PBKDF2-SHA-256 iterations of a new password wrap: 600 000 by default (OWASP 2023). */
  readonly iterations?: number;
  /** The Web Lock every writer of this vault takes. */
  readonly lockName: string;
  /** The name passkeys are registered under (shown by the browser). */
  readonly passkeyName?: string;
}

export const DEFAULT_ITERATIONS = 600_000;
/** A new password must be at least this long. */
export const MIN_PASSWORD_LENGTH = 8;
const REMEMBERED = "remembered";
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_VALUE_LENGTH = 64 * 1024;

const corrupt = (message: string): VaultProblem => ({ code: "corrupt", message });

export function createVault(options: VaultOptions): Vault {
  const { records, keys, authenticator } = options;
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  let dataKey: CryptoKey | undefined;
  /** The vault the data key opens: another one written in its place locks this one. */
  let unlockedId: string | undefined;
  let state: VaultState = { status: "absent", remembered: false, passkeys: [] };
  const listeners = new Set<(state: VaultState) => void>();

  function setState(next: Partial<VaultState>): VaultState {
    const merged = { ...state, ...next };
    if (merged.status !== "corrupt") delete (merged as { reason?: VaultProblem }).reason;
    state = merged;
    for (const listener of [...listeners]) listener(state);
    return state;
  }

  const passkeysOf = (record: VaultRecord) =>
    record.passkeys.map(({ credentialId, createdAt }) => ({ credentialId, createdAt }));

  /** The record as stored now; an unreadable one makes the vault corrupt (and locks it). */
  function current(): VaultRecord | undefined {
    const parsed = parseRecord(records.read());
    if (parsed.kind === "record") return parsed.record;
    dataKey = undefined;
    unlockedId = undefined;
    if (parsed.kind === "absent") {
      setState({ status: "absent", passkeys: [] });
      return undefined;
    }
    const reason: VaultProblem = { code: parsed.kind, message: parsed.message };
    setState({ status: "corrupt", reason, passkeys: [] });
    throw new VaultUnavailableError(parsed.message, reason);
  }

  function requireRecord(): VaultRecord {
    const record = current();
    if (!record) throw new VaultUnavailableError("There is no vault yet.");
    return record;
  }

  /** The data key and the record it opens; locks when the record is another vault's. */
  function requireUnlocked(): { key: CryptoKey; record: VaultRecord } {
    const record = requireRecord();
    if (!dataKey || unlockedId !== record.id) {
      if (dataKey) {
        dataKey = undefined;
        unlockedId = undefined;
        setState({ status: "locked", passkeys: passkeysOf(record) });
      }
      throw new VaultLockedError();
    }
    return { key: dataKey, record };
  }

  /** Unseal with `key`; a failure with a key that unwrapped is an integrity failure: corrupt. */
  async function open(key: CryptoKey, record: VaultRecord): Promise<VaultData> {
    try {
      return await unseal(key, record);
    } catch {
      dataKey = undefined;
      unlockedId = undefined;
      const reason = corrupt(
        "The vault's data fails its integrity check: it was changed or damaged.",
      );
      setState({ status: "corrupt", reason });
      throw new VaultUnavailableError(reason.message, reason);
    }
  }

  async function unlocked(key: CryptoKey, record: VaultRecord, remember: boolean) {
    await open(key, record);
    dataKey = key;
    unlockedId = record.id;
    if (remember) await keys.set(REMEMBERED, key);
    setState({
      status: "unlocked",
      passkeys: passkeysOf(record),
      remembered: remember || state.remembered,
    });
  }

  const lockName = options.lockName;
  const writeLocked = <T>(action: () => Promise<T>) => exclusive(lockName, action);

  function write(record: VaultRecord) {
    records.write(JSON.stringify(record));
  }

  async function change(edit: (secrets: Record<string, string>) => void): Promise<void> {
    await writeLocked(async () => {
      const { key, record } = requireUnlocked();
      const data = await open(key, record);
      const secrets = { ...data.secrets };
      edit(secrets);
      write({ ...record, data: await seal(key, record.id, { secrets }) });
    });
  }

  async function read(): Promise<VaultData> {
    const { key, record } = requireUnlocked();
    return open(key, record);
  }

  function checkName(name: string) {
    if (!NAME.test(name)) throw new TypeError(`vault: not a secret name: ${JSON.stringify(name)}`);
  }

  return {
    state: () => state,
    observe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async load() {
      dataKey = undefined;
      unlockedId = undefined;
      let record: VaultRecord | undefined;
      try {
        record = current();
      } catch {
        return state; // corrupt: reported, nothing touched
      }
      const remembered = await keys.get(REMEMBERED);
      if (!record) return setState({ remembered: remembered !== undefined });
      if (remembered) {
        try {
          await unseal(remembered, record);
          dataKey = remembered;
          unlockedId = record.id;
          return setState({ status: "unlocked", remembered: true, passkeys: passkeysOf(record) });
        } catch {
          // A key remembered for another vault, or that no longer opens this one: the password
          // still does (and reports a vault whose data was damaged).
          await keys.delete(REMEMBERED);
        }
      }
      return setState({ status: "locked", remembered: false, passkeys: passkeysOf(record) });
    },

    async create(password, { remember = false } = {}) {
      if (password.length < MIN_PASSWORD_LENGTH) {
        throw new RangeError(
          `vault: the password needs at least ${MIN_PASSWORD_LENGTH} characters`,
        );
      }
      await writeLocked(async () => {
        if (current()) throw new VaultUnavailableError("A vault exists already.");
        const id = toBase64Url(random(16));
        const extractable = await newDataKey();
        const record: VaultRecord = {
          version: VAULT_VERSION,
          id,
          password: await newPasswordWrap(extractable, id, password, iterations),
          passkeys: [],
          data: await seal(extractable, id, { secrets: {} }),
        };
        write(record);
        // The key kept in memory (and remembered) is the non-extractable one the password unwraps.
        await unlocked(await unwrapWithPassword(record, password, false), record, remember);
      });
    },

    async unlock(password, { remember = false } = {}) {
      const record = requireRecord();
      let key: CryptoKey;
      try {
        key = await unwrapWithPassword(record, password, false);
      } catch {
        return false;
      }
      await unlocked(key, record, remember);
      return true;
    },

    async unlockWithPasskey({ remember = false } = {}) {
      const record = requireRecord();
      if (!authenticator) throw new PasskeyProblem(PASSKEY_MESSAGES.unsupported);
      if (record.passkeys.length === 0) throw new PasskeyProblem(PASSKEY_MESSAGES.unknown);
      const answer = await authenticator.get(record.passkeys.map((p) => p.credentialId));
      const passkey = record.passkeys.find((p) => p.credentialId === answer.credentialId);
      if (!passkey) return false;
      let key: CryptoKey;
      try {
        key = await unwrapWithPasskey(record, passkey, answer.secret);
      } catch {
        return false;
      }
      await unlocked(key, record, remember);
      return true;
    },

    async passkeysAvailable() {
      return (await authenticator?.available()) ?? false;
    },

    async addPasskey(password, { name } = {}) {
      if (!authenticator) throw new PasskeyProblem(PASSKEY_MESSAGES.unsupported);
      const record = requireRecord();
      let extractable: CryptoKey;
      try {
        extractable = await unwrapWithPassword(record, password, true);
      } catch {
        return false;
      }
      await open(extractable, record);
      const { credentialId, secret } = await authenticator.create({
        id: record.id,
        name: name ?? options.passkeyName ?? "Vault",
      });
      const passkey = await newPasskeyWrap(extractable, record.id, credentialId, secret);
      await writeLocked(async () => {
        const now = requireRecord();
        if (now.id !== record.id) throw new VaultUnavailableError("The vault was replaced.");
        const passkeys = [...now.passkeys.filter((p) => p.credentialId !== credentialId), passkey];
        write({ ...now, passkeys });
        setState({ passkeys: passkeysOf({ ...now, passkeys }) });
      });
      return true;
    },

    async removePasskey(credentialId) {
      await writeLocked(async () => {
        const { record } = requireUnlocked();
        const passkeys = record.passkeys.filter((p) => p.credentialId !== credentialId);
        write({ ...record, passkeys });
        setState({ passkeys: passkeysOf({ ...record, passkeys }) });
      });
    },

    lock() {
      dataKey = undefined;
      unlockedId = undefined;
      if (state.status === "unlocked") setState({ status: "locked" });
    },

    async forget() {
      await keys.delete(REMEMBERED);
      setState({ remembered: false });
    },

    secrets(namespace) {
      if (!isFragmentId(namespace)) {
        throw new TypeError(`vault: not a namespace (a fragment id): ${JSON.stringify(namespace)}`);
      }
      const full = (name: string) => {
        checkName(name);
        return `${namespace}/${name}`;
      };
      return {
        namespace,
        async get(name) {
          const key = full(name);
          const { secrets } = await read();
          return Object.hasOwn(secrets, key) ? secrets[key] : undefined;
        },
        async put(name, value) {
          const key = full(name);
          if (typeof value !== "string" || value.length > MAX_VALUE_LENGTH) {
            throw new TypeError(`vault: ${key}: a secret is a string of at most 64 KiB`);
          }
          await change((secrets) => {
            secrets[key] = value;
          });
        },
        async delete(name) {
          const key = full(name);
          await change((secrets) => {
            delete secrets[key];
          });
        },
        async names() {
          const { secrets } = await read();
          return Object.keys(secrets)
            .filter((k) => k.startsWith(`${namespace}/`))
            .map((k) => k.slice(namespace.length + 1))
            .sort();
        },
      };
    },
  };
}
