import type { Git } from "@statewalker/vcs-commands";
import { GitWorkingCopyConfig } from "@statewalker/vcs-store-files";
import type { Credentials, PushRefUpdate } from "@statewalker/vcs-transport";
import {
  createTransportRefStore,
  isPushSuccess,
  fetch as transportFetch,
  push as transportPush,
} from "@statewalker/vcs-transport";
import type { FilesApi } from "@statewalker/webrun-files";
import { configFilesOf } from "../adapters/config-files.js";
import { historyOf, repositoryFacadeOf } from "../adapters/repository-facade.js";

/** Where a repository keeps its remotes — the same file native git reads. */
export const CONFIG_PATH = ".git/config";

/** The remote a bare `push()` / `fetch()` targets. */
export const DEFAULT_REMOTE = "origin";

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
 * Deliberately carries **no pushed object id**. The transport's `PushRefUpdate.newOid`
 * is the value the client *read and sent*, not a confirmation of what the server
 * stored, and the local ref can move while the push is in flight. The only sound
 * witness of what landed is the server's own ref store.
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

/**
 * Raised when a URL is not usable as an HTTP remote.
 *
 * **The URL is redacted, and {@link url} is the redacted form** — there is no
 * unredacted copy anywhere on this error. One of the reasons this is raised *is*
 * "the URL carries credentials", so this class is the one place in the package
 * guaranteed to be holding a token when it formats a string, and `message` and
 * `stack` reach every log, crash reporter and UI. Invariant 4 is about the token,
 * not about the file it might have been written to.
 */
export class InvalidRemoteUrlError extends Error {
  readonly url: string;

  constructor(url: string, reason: string) {
    const redacted = redactUserinfo(url);
    super(`invalid HTTP remote URL '${redacted}': ${reason}`);
    this.url = redacted;
    this.name = "InvalidRemoteUrlError";
  }
}

/**
 * Replace a URL's userinfo with `***`, on the raw string.
 *
 * Textual rather than `new URL()`-based, deliberately: this runs on input that was
 * refused precisely *because* it does not parse the way it looks. `new URL()` puts
 * nothing in `username`/`password` for an opaque scheme, so
 * `gitnature:<token>@example.test` would come back untouched.
 *
 * Anchored at the start of the string or at a `//`, so a `@` inside a path
 * (`https://h.test/@scope/pkg.git`) is left alone. It over-redacts rather than
 * under-redacts — `git@example.test:x.git` becomes `***@example.test:x.git` — which
 * is the right way round for a guard whose failure mode is printing a live token.
 */
function redactUserinfo(url: string): string {
  return url.replace(/(^|\/\/)([^\s/@]*)@/g, (_match, lead: string) => `${lead}***@`);
}

/** Raised when a remote name is not safe to write into `.git/config`. */
export class InvalidRemoteNameError extends Error {
  constructor(
    readonly remote: string,
    reason: string,
  ) {
    super(
      `invalid remote name ${JSON.stringify(remote)}: ${reason}. ` +
        `Allowed: ${REMOTE_NAME_DESCRIPTION}.`,
    );
    this.name = "InvalidRemoteNameError";
  }
}

/**
 * What a remote name may look like.
 *
 * Deliberately narrower than git's own rules. The name is interpolated into the
 * subsection of `[remote "<name>"]`, and `GitWorkingCopyConfig.serializeValue`
 * escapes a `"` and **nothing else** — never a newline — so anything outside this
 * set is either an injection or a silent rename:
 *
 * - A **newline** ends the header line and starts a new section. The proven
 *   payload `x"]\n[core]\n\tsshCommand=/tmp/pwn.sh\n[a "b` makes real git report
 *   `core.sshCommand = /tmp/pwn.sh` — a command it executes on every ssh
 *   operation — while staying invisible to both `git remote -v` and
 *   {@link listHttpRemotes}, because neither reads the section it created.
 * - **Whitespace** survives the write but not the read: `parseGitConfig`
 *   collapses whitespace inside a section header to a dot, so `up stream` comes
 *   back as `up.stream`.
 * - A **quote** is dropped by {@link configEntries}, so `a"b` comes back as `ab`.
 *
 * The last two are renames rather than injections, but a remote that cannot be
 * found under the name it was added with is the same failure to the caller.
 */
const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

const REMOTE_NAME_DESCRIPTION =
  "letters, digits, '.', '_', '/' and '-', starting with a letter or digit";

/**
 * The single spelling of a remote name that this package stores anything under.
 *
 * Lower-cased because `GitWorkingCopyConfig` lower-cases every key it parses or
 * sets. Real git treats the section and key as case-insensitive but the
 * **subsection** (the remote name) as case-sensitive, so `addHttp("Origin", …)`
 * and `addHttp("origin", …)` are one remote here and two in git.
 *
 * **Both keys go through this.** They used to disagree: the URL key lower-cased and
 * the credentials key did not, so `addHttp("Origin", url, {credentials})` stored the
 * secret under `Origin` while `list()` reported `origin` — and the `push("origin")`
 * that followed went out anonymously and came back 401 with nothing to explain it.
 */
function canonicalRemoteName(name: string): string {
  return name.toLowerCase();
}

/** The `.git/config` key holding a remote's URL. */
export function remoteUrlKey(name: string): string {
  return `remote.${canonicalRemoteName(name)}.url`;
}

/**
 * The `Secrets` key holding one remote's credentials, scoped per project.
 *
 * Keyed on the project's **path**, not its name: `Project.projectName` is the last
 * path segment, so `x/inner` and `y/inner` are both `inner` and would share one
 * credentials entry — the second project silently overwriting the first's token.
 */
export function remoteCredentialsKey(projectPath: string, remote: string): string {
  return `vcs.remote.${projectPath}.${canonicalRemoteName(remote)}`;
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
 *
 * **Both arguments are validated before either reaches the file**, because the
 * writer escapes a `"` and nothing else: see {@link REMOTE_NAME} for the name and
 * {@link assertHttpRemoteUrl} for the URL. Nothing is written when either is
 * refused — the config is left byte-for-byte as it was.
 */
export async function addHttpRemote(files: FilesApi, name: string, url: string): Promise<void> {
  assertRemoteName(name);
  const href = assertHttpRemoteUrl(url);
  const entries = configEntries(await loadConfig(files));
  entries.set(remoteUrlKey(name), href);

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

/** Reject a remote name that `.git/config` cannot carry back unchanged. */
function assertRemoteName(name: string): void {
  if (name === "") throw new InvalidRemoteNameError(name, "a remote name cannot be empty");
  if (/[\n\r]/.test(name)) {
    throw new InvalidRemoteNameError(
      name,
      `a newline would close the [remote "…"] header and start a new ${CONFIG_PATH} ` +
        "section, which git then honours",
    );
  }
  if (!REMOTE_NAME.test(name)) {
    throw new InvalidRemoteNameError(name, "it holds characters this config writer cannot store");
  }
}

/**
 * Reject anything that is not an absolute `http(s)` URL, and anything carrying
 * userinfo. Returns the **parsed** `href` — the string that was actually
 * inspected, and therefore the only one safe to store.
 *
 * The userinfo check is an invariant-4 guard, not pedantry: `.git/config` is
 * plaintext and world-readable, so `https://user:token@host/repo.git` would persist
 * a credential outside the `Secrets` store the moment it were stored. Credentials
 * go through `addHttp`'s `credentials` option instead.
 *
 * **The raw string is refused when it holds a control character, and the `href` is
 * what gets stored.** The WHATWG parser strips `\t`, `\n` and `\r` *before*
 * parsing, so validating `parsed` and storing `url` validates a different string
 * from the one that reaches the file: `https://h.test/r.git\n[core]\n\tsshCommand=…`
 * parses cleanly and lands as three config lines. Explicit rejection is preferred
 * to silent sanitisation so the caller learns the URL was not the one they passed.
 */
function assertHttpRemoteUrl(url: string): string {
  if (/[\n\r\t\0]/.test(url)) {
    throw new InvalidRemoteUrlError(
      url,
      `it holds a control character; the URL parser would drop it while ${CONFIG_PATH} ` +
        "would keep it, and a newline there starts a config section git honours",
    );
  }

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
  return parsed.href;
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
 * `PushCommand` is bypassed because **it cannot be handed a `fetch`**: `fetchImpl`
 * exists only on `BaseHttpOptions`, `PushCommand.call()` never forwards one, and
 * `TransportCommand` exposes no transport injection, so the porcelain is hard-wired to
 * `globalThis.fetch`. Reaching it means stubbing a global — which this nature refuses
 * to do, since its whole dependency story is `registerVcs(workspace, deps)`.
 *
 * The transport's push client decides each ref as `git push` does: a refused ref
 * (`rejected-*` before the wire, `remote-rejected` by the receiver) is reported in
 * {@link PushOutcome.updates} with its reason rather than thrown. Transport failures
 * (an HTTP error, a 401) throw.
 */
export async function pushToHttpRemote(options: PushToHttpRemoteOptions): Promise<PushOutcome> {
  const { git, url, fetchImpl, ref, auth, force = false } = options;

  const result = await transportPush({
    url,
    fetchImpl,
    auth,
    force,
    refspecs: [`${force ? "+" : ""}${ref}:${ref}`],
    repository: repositoryFacadeOf(git),
    refStore: createTransportRefStore(historyOf(git).refs),
  });

  return { url, ok: result.ok, updates: result.updates.map(refPushOutcomeOf) };
}

/** One transport ref update → this package's `{ref, ok, message}`. */
function refPushOutcomeOf(update: PushRefUpdate): RefPushOutcome {
  const ok = isPushSuccess(update.status);
  // `message` is the receiver's reason (`remote-rejected`); a refusal decided before
  // the wire has none, and git's status column (`[rejected] (fetch first)`) says why.
  const message = update.message ?? (ok ? undefined : update.summary);
  return message === undefined
    ? { ref: update.remoteRef, ok }
    : { ref: update.remoteRef, ok, message };
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
 * The transport's fetch client does the whole job: it imports the pack through the
 * repository facade's `importPack` and writes the tracking refs the refspec maps,
 * each with its old value checked. `FetchCommand` is bypassed for the same reason
 * as `PushCommand` in {@link pushToHttpRemote}: it cannot be handed a `fetch`.
 *
 * Only `refs/heads/*` is mapped (`+refs/heads/*:refs/remotes/<remote>/*`), and tag
 * auto-follow is off. Tags and other namespaces are advertised but left alone — this
 * nature has no tag surface, and inventing a mapping for refs it cannot show would be
 * state nobody asked for.
 *
 * Throws when the ref store refused a tracking ref (it changed while the fetch ran):
 * the objects are in, but {@link FetchOutcome.updated} would otherwise name a ref
 * that was not written.
 */
export async function fetchFromHttpRemote(
  options: FetchFromHttpRemoteOptions,
): Promise<FetchOutcome> {
  const { git, url, fetchImpl, remote, auth } = options;

  const result = await transportFetch({
    url,
    fetchImpl,
    auth,
    repository: repositoryFacadeOf(git),
    refStore: createTransportRefStore(historyOf(git).refs),
    refspecs: [`+refs/heads/*:refs/remotes/${remote}/*`],
    tags: "none",
  });

  const rejected = result.refUpdates.filter((u) => u.status === "rejected");
  if (rejected.length > 0) {
    const detail = rejected
      .map((u) => `${u.localRef}: ${u.reason ?? "no reason reported"}`)
      .join("; ");
    throw new Error(`fetch from ${url} could not write its tracking refs: ${detail}`);
  }

  const updated = new Map<string, string>();
  for (const update of result.refUpdates) updated.set(update.localRef, update.newOid);

  const objectsImported = result.imports.reduce((sum, i) => sum + i.objectsImported, 0);
  return { url, updated, objectsImported };
}
