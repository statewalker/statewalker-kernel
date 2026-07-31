import type { Git } from "@statewalker/vcs-commands";
import { GitWorkingCopyConfig } from "@statewalker/vcs-store-files";
import type { Credentials } from "@statewalker/vcs-transport";
import { fetch as transportFetch, push as transportPush } from "@statewalker/vcs-transport";
import type { FilesApi } from "@statewalker/webrun-files";
import { configFilesOf } from "../adapters/config-files.js";
import { historyOf, serializationOf } from "../adapters/repository-facade.js";

/** Where a repository keeps its remotes — the same file native git reads. */
export const CONFIG_PATH = ".git/config";

/** The remote a bare `push()` / `fetch()` targets. */
export const DEFAULT_REMOTE = "origin";

/** The ref namespace a branch lives in. */
const HEADS_PREFIX = "refs/heads/";

/** A remote as this nature stores it: a name and an absolute HTTP(S) URL. */
export interface HttpRemote {
  name: string;
  url: string;
}

/**
 * Credentials for one remote. They live in the workspace `Secrets` adapter and
 * are never written to `.git/config`, `nature.vcs.json`, or a committed tree.
 */
export interface RemoteCredentials {
  username: string;
  password: string;
}

/** What a push reports for one ref. */
export interface RefPushOutcome {
  /** The ref name **on the server**. */
  ref: string;
  ok: boolean;
  message?: string;
}

/**
 * What a push reports.
 *
 * Deliberately carries **no pushed object id**. The transport reports every
 * `RemoteRefUpdate.newObjectId` as `""` (`push-command.ts:326-336` has the literal
 * and the comment "Would need to track this"), so any `id` here would be a
 * fabrication. The only sound witness of what landed is the server's own ref store.
 */
export interface PushOutcome {
  /** The absolute URL actually pushed to. */
  url: string;
  ok: boolean;
  updates: RefPushOutcome[];
}

/** What a fetch reports. */
export interface FetchOutcome {
  url: string;
  /** Remote-tracking refs written: `refs/remotes/<remote>/<branch>` → object id. */
  updated: Map<string, string>;
  objectsImported: number;
}

/** Raised when a remote name has no entry in this repository's `.git/config`. */
export class UnknownRemoteError extends Error {
  constructor(readonly remote: string) {
    super(
      `unknown remote '${remote}': no remote.${remote}.url in ${CONFIG_PATH}. ` +
        "Add it with remotes.addHttp(name, url) first.",
    );
    this.name = "UnknownRemoteError";
  }
}

/** Raised when a URL is not usable as an HTTP remote. */
export class InvalidRemoteUrlError extends Error {
  constructor(
    readonly url: string,
    reason: string,
  ) {
    super(`invalid HTTP remote URL '${url}': ${reason}`);
    this.name = "InvalidRemoteUrlError";
  }
}

/**
 * The `.git/config` key holding a remote's URL.
 *
 * Lower-cased because `GitWorkingCopyConfig` lower-cases every key it parses or
 * sets. Real git treats the section and key as case-insensitive but the
 * **subsection** (the remote name) as case-sensitive, so `addHttp("Origin", …)`
 * and `addHttp("origin", …)` are one remote here and two in git.
 */
export function remoteUrlKey(name: string): string {
  return `remote.${name.toLowerCase()}.url`;
}

/** The `Secrets` key holding one remote's credentials, scoped per project. */
export function remoteCredentialsKey(projectName: string, remote: string): string {
  return `vcs.remote.${projectName}.${remote}`;
}

/**
 * Record an HTTP(S) remote in `.git/config`.
 *
 * **Not through `RemoteAddCommand`.** That command's `storeRemoteConfig()` is an
 * empty method body (`commands/src/commands/remote-command.ts:167-170`, comment:
 * "In a full implementation, this would write to git config") and `RemoteListCommand`
 * scans `refs/remotes/` and hard-codes `urls: []`. After `remoteAdd().call()` the
 * config file is byte-for-byte unchanged and `remoteList().call()` returns `[]` —
 * remotes are never stored anywhere, on disk or in memory.
 *
 * `GitWorkingCopyConfig` really does write the file, at three documented costs:
 *
 * 1. **`save()` re-serializes from scratch, so comments are lost.** Anything a human
 *    or another tool wrote as `#`/`;` in `.git/config` disappears on the first
 *    `addHttp`.
 * 2. **`values` is a flat `Map`, so repeated keys collapse.** Git's config format
 *    allows a key more than once — notably a second `fetch` refspec — and only the
 *    last occurrence survives a load/save round-trip.
 * 3. **Subsections do not round-trip.** `save()` writes the correct git syntax
 *    `[remote "origin"]`, but `load()` parses that header as the section
 *    `remote."origin"` — quotes and all — so the key comes back as
 *    `remote."origin".url`. Left alone, a second `addHttp` would then hold *both*
 *    spellings and emit `[remote ""origin""]`. {@link configEntries} canonicalises
 *    the keys on the way in, and this function rewrites the whole config from them,
 *    which makes `addHttp` idempotent and keeps the file readable by native git.
 *
 * All three are pinned by tests. None loses a *remote*, which is what this nature
 * stores; a repository that also holds hand-written config is the case to be aware of.
 */
export async function addHttpRemote(files: FilesApi, name: string, url: string): Promise<void> {
  assertHttpRemoteUrl(url);
  const entries = configEntries(await loadConfig(files));
  entries.set(remoteUrlKey(name), url);

  const next = new GitWorkingCopyConfig(configFilesOf(files), CONFIG_PATH);
  for (const [key, value] of entries) next.set(key, value);
  await next.save();
}

/** Every remote recorded in `.git/config`, in the order the file lists them. */
export async function listHttpRemotes(files: FilesApi): Promise<HttpRemote[]> {
  const remotes: HttpRemote[] = [];
  for (const [key, value] of configEntries(await loadConfig(files))) {
    const name = /^remote\.(.+)\.url$/.exec(key)?.[1];
    if (name && typeof value === "string") remotes.push({ name, url: value });
  }
  return remotes;
}

/** One remote's URL, or `undefined` when `.git/config` has no such remote. */
export async function httpRemoteUrl(files: FilesApi, name: string): Promise<string | undefined> {
  const url = configEntries(await loadConfig(files)).get(remoteUrlKey(name));
  return typeof url === "string" ? url : undefined;
}

async function loadConfig(files: FilesApi): Promise<GitWorkingCopyConfig> {
  const config = new GitWorkingCopyConfig(configFilesOf(files), CONFIG_PATH);
  await config.load();
  return config;
}

/**
 * Every config key/value, canonicalised, in file order.
 *
 * `GitWorkingCopyConfig` keeps `values` private but mirrors every key onto the
 * instance — both `parseGitConfig` and `set` do `this[fullKey] = value`, and the
 * class declares `[key: string]: unknown` for exactly that — so own enumerable keys
 * are the only way to *enumerate*; `get()` requires already knowing the key.
 *
 * Its three own fields (`files`, `configPath`, `values`) are filtered out by the
 * dot test rather than by name: every parsed config key is `section.key`, because
 * `parseGitConfig` only omits the section prefix for a key that appears before any
 * `[section]` header — which git's own format does not allow.
 */
function configEntries(config: GitWorkingCopyConfig): Map<string, unknown> {
  const entries = new Map<string, unknown>();
  for (const key of Object.keys(config)) {
    if (!key.includes(".")) continue;
    // `[remote "origin"]` comes back as `remote."origin"` — see limit 3 above.
    entries.set(key.replace(/"/g, ""), config[key]);
  }
  return entries;
}

/**
 * Reject anything that is not an absolute `http(s)` URL, and anything carrying
 * userinfo.
 *
 * The userinfo check is an invariant-4 guard, not pedantry: `.git/config` is
 * plaintext and world-readable, so `https://user:token@host/repo.git` would persist
 * a credential outside the `Secrets` store the moment it were stored. Credentials
 * go through `addHttp`'s `credentials` option instead.
 */
function assertHttpRemoteUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidRemoteUrlError(url, "not an absolute URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidRemoteUrlError(
      url,
      `unsupported scheme '${parsed.protocol}' (http/https only)`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new InvalidRemoteUrlError(
      url,
      `credentials in the URL would be written to ${CONFIG_PATH} in plaintext — ` +
        "pass them as addHttp(name, url, { credentials }) instead",
    );
  }
}

/**
 * Adapt a `(url, init)` fetch to the `(Request) => Response` shape transport wants.
 *
 * The nature holds a `FetchFn` because that is what a host injects; `BaseHttpOptions.fetchImpl`
 * is `(request: Request) => Promise<Response>`. The body is **buffered** rather than
 * forwarded as a stream: a `ReadableStream` body needs Node's non-standard
 * `duplex: "half"`, which is absent from `RequestInit`, and every request the smart-HTTP
 * client builds already has its body fully in memory — so buffering costs nothing and
 * removes a platform dependency.
 */
export function fetchImplOf(
  fetch: (input: string, init?: RequestInit) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const body = hasBody ? new Uint8Array(await request.arrayBuffer()) : undefined;
    return fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: body as BodyInit | undefined,
      signal: request.signal,
    });
  };
}

export interface PushToHttpRemoteOptions {
  git: Git;
  url: string;
  fetchImpl: (request: Request) => Promise<Response>;
  /** Source ref, e.g. `refs/heads/main`. Pushed to the same name on the server. */
  ref: string;
  auth?: Credentials;
  force?: boolean;
}

/**
 * Push one ref over smart HTTP, straight through `@statewalker/vcs-transport`.
 *
 * `PushCommand` is bypassed for two reasons, both structural rather than stylistic:
 *
 * - **It cannot be handed a `fetch`.** `fetchImpl` exists only on `BaseHttpOptions`;
 *   `PushCommand.call()` never forwards one and `TransportCommand` exposes no transport
 *   injection, so the porcelain is hard-wired to `globalThis.fetch`. Reaching it means
 *   stubbing a global — which this nature refuses to do, since its whole dependency
 *   story is `registerVcs(workspace, deps)`.
 * - **Its `exportPack` comes back `undefined` here.** It reads `serialization` off the
 *   history, and a file-backed `History` has no such member — so the push would fall
 *   back to the hand-rolled object walker rather than a real pack.
 */
export async function pushToHttpRemote(options: PushToHttpRemoteOptions): Promise<PushOutcome> {
  const { git, url, fetchImpl, ref, auth, force = false } = options;
  const history = historyOf(git);
  const serialization = serializationOf(git);

  const result = await transportPush({
    url,
    fetchImpl,
    auth,
    force,
    refspecs: [`${force ? "+" : ""}${ref}:${ref}`],
    getLocalRef: async (name: string) => (await history.refs.resolve(name))?.objectId,
    exportPack: (wants: Set<string>, exclude: Set<string>) =>
      serialization.createPack(history.collectReachableObjects(wants, exclude)),
  });

  return {
    url,
    ok: result.ok,
    updates: [...result.updates].map(([name, update]) => ({
      ref: name,
      ok: update.ok,
      message: update.message,
    })),
  };
}

export interface FetchFromHttpRemoteOptions {
  git: Git;
  url: string;
  fetchImpl: (request: Request) => Promise<Response>;
  /** Remote name — only used to name the tracking refs it writes. */
  remote: string;
  auth?: Credentials;
}

/**
 * Fetch a remote's branches into remote-tracking refs, importing the pack.
 *
 * The import is the part `FetchCommand` does **not** do: its `storePack()` is an
 * empty method body (`fetch-command.ts:588-591`, comment "Pack data is stored
 * individually by the transport layer"), so the porcelain writes the tracking refs
 * and drops every object they point at. `transportFetch` likewise only *returns*
 * `packData`. Importing it here is what makes the fetched commit readable.
 *
 * Only `refs/heads/*` is mapped. Tags and other namespaces are advertised but left
 * alone — this nature has no tag surface, and inventing a mapping for refs it cannot
 * show would be state nobody asked for.
 */
export async function fetchFromHttpRemote(
  options: FetchFromHttpRemoteOptions,
): Promise<FetchOutcome> {
  const { git, url, fetchImpl, remote, auth } = options;
  const history = historyOf(git);

  const raw = await transportFetch({ url, fetchImpl, auth });

  let objectsImported = 0;
  if (raw.packData.length > 0) {
    const pack = raw.packData;
    const imported = await serializationOf(git).importPack(
      (async function* () {
        yield pack;
      })(),
    );
    objectsImported = imported.objectsImported;
  }

  const updated = new Map<string, string>();
  for (const [refName, objectId] of raw.refs) {
    if (!refName.startsWith(HEADS_PREFIX)) continue;
    const tracking = `refs/remotes/${remote}/${refName.slice(HEADS_PREFIX.length)}`;
    const oid = bytesToHex(objectId);
    await history.refs.set(tracking, oid);
    updated.set(tracking, oid);
  }

  return { url, updated, objectsImported };
}

/** The transport reports ref ids as raw 20-byte SHA-1s; refs are stored as hex. */
function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}
