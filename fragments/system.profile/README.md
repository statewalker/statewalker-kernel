# system.profile

## What it is

The core fragment that keeps the user's profile on this device: JSON values under string keys, in Web Storage (`localStorage`) or in memory, and the **vault**, where secrets are kept encrypted. system.workbench keeps its layouts per device mode in the profile, system.settings each fragment's settings values (under `settings/<fragment-id>`), and the store is a `KernelProfile`, so the kernel keeps its fragment records in it too. Its client half is the vault view, with an entry in the activity bar. The `secrets` point (each fragment's declared secrets, given to its server half as env bindings) comes with statewalker-root#265. It is a private workspace package, `@statewalker/system.profile`: `src/` has no React, no DOM rendering and no Node built-ins; `client/` is React.

## Why it exists

ADR `2026-11-20-kernel-and-core-fragments` (statewalker-root) gives `system.profile` the user's state: settings values, saved layouts, the route table and the vault, local to the device (spec statewalker-root#215, user stories 30 to 32). ADR `2026-11-19-code-kinds-and-trust` says how the vault is built: after sandclaw's (`file-mounts.core`'s `SecretVault`), a random AES-GCM data key wrapped by a PBKDF2 password key and by each passkey (WebAuthn PRF), an optional non-extractable key remembered on this device, Web Locks across tabs, and a vault that stays locked when it cannot be read.

## How to use

```ts
import {
  createIndexedDbKeyStore,
  createSystemProfile,
  createWebAuthnPasskeys,
  SYSTEM_PROFILE_ID,
  systemProfileArchive,
} from "@statewalker/system.profile";

const profile = createSystemProfile({
  storage: localStorage,
  prefix: "org.example.app:",
  vault: {
    keys: createIndexedDbKeyStore("org.example.app:vault"),
    authenticator: createWebAuthnPasskeys({ rpName: "Example" }),
  },
});
await profile.vault.load(); // locked, unlocked by a remembered key, absent, or corrupt

await profile.vault.create("a long password", { remember: false });
const mail = profile.vault.secrets("org.example.mail");
await mail.put("api-key", "sk-...");
await mail.get("api-key"); // "sk-..."
profile.vault.lock();
await mail.get("api-key"); // throws VaultLockedError
```

| Export | Provides |
| --- | --- |
| `systemProfileArchive`, `SYSTEM_PROFILE_ID`, `VAULT_VIEW` | The fragment's files (`fragment.jsonc`, `fragment.client.jsonc`: the vault view and its activity bar entry), for `createKernel({ core })`. |
| `createSystemProfile({ storage?, prefix?, vault? })` → `{ store, vault, activate }` | The fragment's code: its store over `storage` (memory by default), every key under `prefix`, its vault (its record under the `vault` key of the same storage), and the body of its client activator. `vault`: `keys` (where a remembered key is kept; memory by default), `authenticator` (passkeys), `iterations`, `passkeyName`. |
| `ProfileStore` | `get(key)` (a copy; `undefined` when absent or not JSON), `set(key, value)` (throws a `TypeError` for a value JSON cannot hold, and whatever the storage throws), `delete(key)`, `keys(prefix?)`. A `KernelProfile`. The `vault` key is the vault's: leave it alone. |
| `Vault` | `state()` and `observe(listener)`: the public state (`status`: `absent`, `locked`, `unlocked` or `corrupt`; `reason` when corrupt, `{ code: "corrupt" \| "unknown-version", message }`; `remembered`; the passkeys' ids and dates), never a secret. `load()`, `create(password, { remember })`, `unlock(password, { remember })` (false: wrong password), `unlockWithPasskey({ remember })`, `passkeysAvailable()`, `addPasskey(password)` (the password is checked before the browser asks), `removePasskey(id)`, `lock()`, `forget()` (drops the remembered key), `secrets(namespace)`. |
| `SecretScope` | A namespace's secrets (`namespace` is a fragment id: `system.ai`, `org.example.mail`): `get(name)`, `put(name, value)`, `delete(name)`, `names()`. Names are 1 to 128 of `A-Za-z0-9._-`; values strings up to 64 KiB. Every call needs the vault unlocked (`VaultLockedError`). |
| `VaultLockedError`, `VaultUnavailableError` (`reason`), `PasskeyProblem`, `PASSKEY_MESSAGES` | What the vault throws; their messages never hold a secret. |
| `createIndexedDbKeyStore(name)`, `createMemoryKeyStore()`, `VaultKeyStore` | Where a remembered key is kept, as a `CryptoKey` (structured clone), never as bytes. |
| `createWebAuthnPasskeys({ rpName, rpId? })`, `createMemoryAuthenticator()`, `PasskeyAuthenticator` | The browser's passkeys (discoverable, user verification required, PRF); an authenticator in memory for tests. |
| `VAULT_VERSION`, `DEFAULT_ITERATIONS`, `MIN_PASSWORD_LENGTH` | The record format this code reads and writes (1), PBKDF2's iterations for a new password (600 000), a new password's least length (8). |
| `createStorageProfile(storage, prefix?)`, `createMemoryStorage()`, `StorageLike` | A `ProfileStore` over any `StorageLike`; a Web Storage in memory; the part of Web Storage the store uses. |
| `@statewalker/system.profile/client`: `VaultView`, `vaultModule(vault)`; `/client.css` | The vault view (React, shadcn), and the fragment's client module bound to a vault, for the host's module resolver. |

## Examples

In a browser shell (apps/notes), the vault's view module loads with the view, bound to the vault:

```ts
const coreModules = {
  [SYSTEM_PROFILE_ID]: async () =>
    (await import("@statewalker/system.profile/client")).vaultModule(profile.vault),
};
```

## Internals

### The profile store

Each value is stored as JSON text under `<prefix><key>`, so one storage holds several applications' profiles and `keys()` lists only this one's. Reads parse a copy; text that is not JSON reads as absent. Writes are synchronous: Web Storage is, and the workbench saves a layout as it changes. The profile is local to the device; syncing it between devices is not designed yet.

### The vault

One record, JSON under `<prefix>vault`, every secret part of it ciphertext:

```jsonc
{
  "version": 1,
  "id": "<16 random bytes, base64url>",
  "password": { "kdf": { "name": "PBKDF2", "hash": "SHA-256", "iterations": 600000, "salt": "<16 bytes>" },
                "iv": "<12 bytes>", "wrappedKey": "<48 bytes>" },
  "passkeys": [{ "credentialId": "<base64url>", "salt": "<16 bytes>", "createdAt": "<ISO date>",
                 "iv": "<12 bytes>", "wrappedKey": "<48 bytes>" }],
  "data": { "iv": "<12 bytes>", "data": "<AES-GCM of { secrets: { '<namespace>/<name>': value } }>" }
}
```

- A random 256-bit AES-GCM **data key** seals the data. It is wrapped (AES-GCM `wrapKey`) by a key derived from the password (PBKDF2-SHA-256, a random salt, 600 000 iterations), and once per passkey by a key derived (HKDF-SHA-256, a random salt) from the authenticator's PRF secret for a fixed input. Every AES-GCM operation is bound, as additional data, to `statewalker.vault:<version>:<id>:<purpose>` (`password`, `passkey:<credential id>`, `data`), so no wrap or ciphertext can be moved to another vault, purpose or version.
- The data key is generated extractable only to be wrapped when the vault is made; the key kept while unlocked is the one the password or passkey unwraps, **non-extractable**. "Remember on this device" stores that `CryptoKey` itself in IndexedDB (`<application id>:vault`, key `remembered`): the browser keeps its bytes, script cannot read them. A remembered key that no longer opens the record is dropped, and the vault is locked.
- Adding a passkey unwraps an extractable copy of the data key with the password, for that one wrap, so a wrong password never reaches the browser's prompt.
- Every write (create, put, delete, passkeys) re-reads and re-parses the record under one lock: a queue in the tab, `navigator.locks` (`statewalker.vault:<prefix>`) across tabs, so another tab's write in between is kept, and nothing is written over a record that no longer parses. Reads re-read the record too.
- **Fail-closed.** A record is parsed strictly (`parseRecord`): text that is not JSON, a missing or malformed field (wrong base64 lengths, more than 32 passkeys, iterations outside 1 to 10 000 000) is `corrupt`; another integer version is `unknown-version`. Either leaves the vault `corrupt` with its `reason`, refuses unlock, create and every secret call (`VaultUnavailableError`), and **never writes the record**. A record that parses but whose data fails its AES-GCM check with a key that unwrapped is `corrupt` too. A wrong password and a tampered wrap are told apart from nothing: both are a wrong password.

### Threat model

What the vault protects, against whom, and the tests that hold it (`tests/vault.test.ts`, seam 1; `apps/notes/tests/vault.e2e.test.ts`, seam 2 in Chromium):

| Threat | Defence | Tests |
| --- | --- | --- |
| Someone reads the device's storage (a copied profile, a backup, another program) | Secrets, their names and the password are never stored; only ciphertext, salts and ivs are. The remembered key is a non-extractable `CryptoKey`. | "stores no secret and no password in clear" (seam 1); "is created and unlocked with a password, and stores nothing in clear", "remembers its key on this device ... non-extractable" (seam 2: every localStorage item and IndexedDB value inspected) |
| Guessing the password offline from a copied record | PBKDF2-SHA-256, 600 000 iterations, a random salt per wrap; a least length of 8 | "refuses a wrong password, and stays locked"; the record's KDF parameters asserted in both seams |
| Changing the stored record (tampering, damage, a crafted record) | AES-GCM authentication on every wrap and on the data; strict parsing; bounded iterations and sizes | "reports tampered data (an AES-GCM authentication failure) as corrupt, and writes nothing"; "does not unlock with a wrap moved from another vault" |
| Losing the secrets to a damaged or newer record (user story 32) | The vault stays locked, says why, and never writes the record | "stays locked on text that is not JSON / a record missing its fields / without a version / of an unknown version ... never writes over it" (seam 1); "stays locked on an unreadable record / a record of an unknown version, says why, and keeps its bytes" (seam 2, over a reload) |
| A stolen unlocked device | `lock()` and `forget()`; without "remember" a reload locks | "remembers its key on this device ... until forgotten" (both seams); the password test's reload |
| Passkey misuse (a dismissed prompt, a removed passkey, another credential) | The PRF secret only unwraps its own wrap (bound to its credential id); a dismissed prompt changes nothing | "unlocks with a passkey (WebAuthn PRF) added with the password" (seam 1, a memory authenticator); "unlocks with a passkey (WebAuthn PRF, a virtual authenticator)" (seam 2) |
| Two tabs writing at once | Web Locks and a re-read under the lock | (not tested: the lock is `navigator.locks`; noted in the pull request) |

Out of scope, by the ADR: code running in the page. A fragment's client half has the origin's full authority (`2026-11-19-code-kinds-and-trust`), so it can call an unlocked vault, or read what a user types; the vault keeps secrets from storage and from agents and sandboxes (which get no vault, statewalker-root#265), not from the page's own code. Nothing here logs a secret, and no error message holds one.

### Migration and rollback

The record is versioned (`version: 1`). This code reads and writes only version 1: a record of any other version stays as it is, locked and reported (`unknown-version`), so rolling the application back past a newer format loses nothing, and a later version that migrates must keep the old one readable until it does. No earlier format exists, so there is nothing to migrate.

### Dependencies

- `@statewalker/kernel.core`: the `KernelProfile` and activation context types, the archive type, `isFragmentId` (namespaces).
- `@statewalker/ui.view.shadcn` (client): the vault view's cards, fields and buttons; React as a peer.

## License

MIT. See [LICENSE](../../LICENSE).
