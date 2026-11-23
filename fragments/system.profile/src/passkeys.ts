// Passkeys that unlock the vault through the WebAuthn PRF extension: the authenticator returns the
// same 32-byte secret for this site, this credential and a fixed input, after verifying the person.
// After sandclaw's `passkeys.ts` (file-mounts.core).
import { fromBase64Url, random, toBase64Url, utf8 } from "./vault-records.js";

/** What the vault needs of an authenticator: create a passkey, or assert one, with its PRF secret. */
export interface PasskeyAuthenticator {
  /** Whether this browser can unlock with a passkey (PRF support). */
  available(): Promise<boolean>;
  /** Registers a passkey for the vault (`user.id`: the vault's id) and returns its PRF secret. */
  create(user: { id: string; name: string }): Promise<{ credentialId: string; secret: Uint8Array }>;
  /** Asks for one of `allow` (credential ids), and returns the one used and its PRF secret. */
  get(allow: readonly string[]): Promise<{ credentialId: string; secret: Uint8Array }>;
}

export const PASSKEY_MESSAGES = {
  unsupported: "This browser can't use passkeys to unlock; use the password.",
  unknown: "This passkey doesn't unlock this vault.",
  noAnswer: "The passkey didn't answer; nothing changed.",
} as const;

/** A passkey step that did not work; the message is what the person sees (never a secret). */
export class PasskeyProblem extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PasskeyProblem";
  }
}

/** The PRF input: fixed, so one credential always gives the same secret on this site. */
const PRF_INPUT = utf8("statewalker.vault v1");

export interface MemoryAuthenticator extends PasskeyAuthenticator {
  /** The next `create` or `get` is dismissed, as when the person closes the prompt. */
  dismissNext: boolean;
  readonly credentials: readonly { id: string; userId: string; name: string }[];
}

/**
 * An authenticator in memory, for tests: each credential has its own HMAC key, and its PRF secret
 * is HMAC-SHA256(key, input), as a real authenticator computes it.
 */
export function createMemoryAuthenticator(opts: { prf?: boolean } = {}): MemoryAuthenticator {
  const prf = opts.prf ?? true;
  const keys = new Map<string, CryptoKey>();
  const credentials: { id: string; userId: string; name: string }[] = [];
  const secretOf = async (id: string) => {
    const key = keys.get(id);
    if (!key) throw new PasskeyProblem(PASSKEY_MESSAGES.unknown);
    return new Uint8Array(await crypto.subtle.sign("HMAC", key, PRF_INPUT));
  };
  const dismissed = () => {
    if (!auth.dismissNext) return false;
    auth.dismissNext = false;
    return true;
  };
  const auth: MemoryAuthenticator = {
    dismissNext: false,
    credentials,
    async available() {
      return prf;
    },
    async create(user) {
      if (dismissed()) throw new PasskeyProblem(PASSKEY_MESSAGES.noAnswer);
      if (!prf) throw new PasskeyProblem(PASSKEY_MESSAGES.unsupported);
      const id = toBase64Url(random(16));
      keys.set(
        id,
        await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
      );
      credentials.push({ id, userId: user.id, name: user.name });
      return { credentialId: id, secret: await secretOf(id) };
    },
    async get(allow) {
      if (dismissed()) throw new PasskeyProblem(PASSKEY_MESSAGES.noAnswer);
      const credential = credentials.findLast((c) => allow.includes(c.id));
      if (!credential) throw new PasskeyProblem(PASSKEY_MESSAGES.noAnswer);
      return { credentialId: credential.id, secret: await secretOf(credential.id) };
    },
  };
  return auth;
}

type PrfOutputs = { enabled?: boolean; results?: { first?: BufferSource } };
const prfOf = (c: PublicKeyCredential) =>
  (c.getClientExtensionResults() as { prf?: PrfOutputs }).prf;
const bytesOf = (b: BufferSource) =>
  b instanceof ArrayBuffer
    ? new Uint8Array(b)
    : new Uint8Array(b.buffer as ArrayBuffer, b.byteOffset, b.byteLength);
const prfInputs = { prf: { eval: { first: PRF_INPUT } } } as AuthenticationExtensionsClientInputs;

/** The browser's passkeys: discoverable credentials, user verification required. */
export function createWebAuthnPasskeys(opts: {
  rpName: string;
  rpId?: string;
}): PasskeyAuthenticator {
  const rpId = opts.rpId ? { rpId: opts.rpId } : {};
  const credentials = () => (globalThis as { navigator?: Navigator }).navigator?.credentials;

  async function ask<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof PasskeyProblem) throw error;
      throw new PasskeyProblem(PASSKEY_MESSAGES.noAnswer, { cause: error });
    }
  }

  const assert = (allow: readonly string[]) =>
    ask(async () => {
      const c = (await credentials()?.get({
        publicKey: {
          challenge: random(32),
          ...rpId,
          userVerification: "required",
          allowCredentials: allow.map((id) => ({ type: "public-key", id: fromBase64Url(id) })),
          extensions: prfInputs,
        },
      })) as PublicKeyCredential | null | undefined;
      const first = c ? prfOf(c)?.results?.first : undefined;
      if (!c || !first) throw new PasskeyProblem(PASSKEY_MESSAGES.unsupported);
      return { credentialId: toBase64Url(c.rawId), secret: bytesOf(first) };
    });

  return {
    async available() {
      const pkc = (globalThis as { PublicKeyCredential?: unknown }).PublicKeyCredential as
        | { getClientCapabilities?(): Promise<Record<string, boolean>> }
        | undefined;
      const capabilities = await pkc?.getClientCapabilities?.().catch(() => undefined);
      return capabilities?.["extension:prf"] === true;
    },
    async create(user) {
      const c = await ask(
        async () =>
          (await credentials()?.create({
            publicKey: {
              rp: { name: opts.rpName, ...(opts.rpId ? { id: opts.rpId } : {}) },
              user: { id: utf8(user.id), name: user.name, displayName: user.name },
              challenge: random(32),
              pubKeyCredParams: [
                { type: "public-key", alg: -7 },
                { type: "public-key", alg: -257 },
              ],
              authenticatorSelection: { residentKey: "required", userVerification: "required" },
              extensions: prfInputs,
            },
          })) as PublicKeyCredential | null | undefined,
      );
      const prf = c ? prfOf(c) : undefined;
      if (!c || !prf?.enabled) throw new PasskeyProblem(PASSKEY_MESSAGES.unsupported);
      const credentialId = toBase64Url(c.rawId);
      // Some authenticators give the secret at creation; the others need one more prompt.
      const first = prf.results?.first;
      if (first) return { credentialId, secret: bytesOf(first) };
      return { credentialId, secret: (await assert([credentialId])).secret };
    },
    get: (allow) => assert(allow),
  };
}
