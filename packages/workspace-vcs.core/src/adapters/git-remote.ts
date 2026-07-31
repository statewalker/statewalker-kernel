import type { Git } from "@statewalker/vcs-commands";
import type { Duplex, PushResult } from "@statewalker/vcs-transport";
import type { GitRemote } from "@statewalker/vcs-workspace";
import type { RemoteCredentials } from "../remotes/http-remote.js";

/** One refspec, canonicalised, with the commit its source ref resolves to **locally**. */
export interface PushTarget {
  /** The refspec as handed to the transport, after canonicalisation. */
  refspec: string;
  /** Local ref, e.g. `refs/heads/main`. */
  source: string;
  /** Remote ref, e.g. `refs/heads/main`. */
  destination: string;
  /** The commit `source` resolved to **before** the push. */
  commit: string;
}

/** Raised when a push did not put the requested refspecs on the remote. */
export class RemotePushError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RemotePushError";
  }
}

export interface HttpGitRemoteOptions {
  url: string;
  fetchFn?: typeof fetch;
  credentials?: RemoteCredentials;
  headers?: Record<string, string>;
}

export interface DuplexGitRemoteOptions {
  connect: () => Duplex | Promise<Duplex>;
  atomic?: boolean;
}

export function httpPushOutcome(_result: PushResult, _targets: PushTarget[]): { commit: string } {
  throw new Error("not implemented");
}

export function duplexPushOutcome(_result: PushResult, _targets: PushTarget[]): { commit: string } {
  throw new Error("not implemented");
}

export function createHttpGitRemote(_git: Git, _options: HttpGitRemoteOptions): GitRemote {
  throw new Error("not implemented");
}

export function createDuplexGitRemote(_git: Git, _options: DuplexGitRemoteOptions): GitRemote {
  throw new Error("not implemented");
}
