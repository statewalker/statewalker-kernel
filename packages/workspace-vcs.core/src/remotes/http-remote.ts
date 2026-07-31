import type { Git } from "@statewalker/vcs-commands";
import type { Credentials } from "@statewalker/vcs-transport";
import type { FilesApi } from "@statewalker/webrun-files";

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

/** What {@link pushToHttpRemote} reports for one ref. */
export interface RefPushOutcome {
  /** The ref name **on the server**. */
  ref: string;
  ok: boolean;
  message?: string;
}

/** What a push reports. Deliberately carries no pushed object id — see below. */
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
  constructor(readonly url: string, reason: string) {
    super(`invalid HTTP remote URL '${url}': ${reason}`);
    this.name = "InvalidRemoteUrlError";
  }
}

/** The `.git/config` key holding a remote's URL. */
export function remoteUrlKey(name: string): string {
  return `remote.${name}.url`;
}

/** The `Secrets` key holding one remote's credentials, scoped per project. */
export function remoteCredentialsKey(projectName: string, remote: string): string {
  return `vcs.remote.${projectName}.${remote}`;
}

export function addHttpRemote(_files: FilesApi, _name: string, _url: string): Promise<void> {
  throw new Error("not implemented");
}

export function listHttpRemotes(_files: FilesApi): Promise<HttpRemote[]> {
  throw new Error("not implemented");
}

export function httpRemoteUrl(_files: FilesApi, _name: string): Promise<string | undefined> {
  throw new Error("not implemented");
}

/** A `(url, init)` fetch adapted to the `(Request) => Response` shape transport wants. */
export function fetchImplOf(
  _fetch: (input: string, init?: RequestInit) => Promise<Response>,
): (request: Request) => Promise<Response> {
  throw new Error("not implemented");
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

export function pushToHttpRemote(_options: PushToHttpRemoteOptions): Promise<PushOutcome> {
  throw new Error("not implemented");
}

export interface FetchFromHttpRemoteOptions {
  git: Git;
  url: string;
  fetchImpl: (request: Request) => Promise<Response>;
  /** Remote name — only used to name the tracking refs it writes. */
  remote: string;
  auth?: Credentials;
}

export function fetchFromHttpRemote(_options: FetchFromHttpRemoteOptions): Promise<FetchOutcome> {
  throw new Error("not implemented");
}
