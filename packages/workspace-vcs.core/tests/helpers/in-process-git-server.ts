/**
 * An in-process Git smart-HTTP server: a real `createFetchHandler` over a real
 * file-backed repository, plus an injectable `fetch` that reaches it without a
 * network port.
 *
 * **Ported, not imported.** The equivalent lives at
 * `vcs/packages/commands/tests/transport-test-helper.ts`, but `@statewalker/vcs-commands`
 * ships `files: ["dist"]` and declares no `./tests` export, so that module is
 * unreachable from here — copying it is the only option, not a shortcut.
 *
 * Two things this differs from the upstream helper on, both deliberate:
 *
 * - **The repository is file-backed, not memory-backed.** It is built by the same
 *   `openGitRepo` the nature itself uses, over a `MemFilesApi`. That drops the
 *   `@statewalker/vcs-store-mem` dependency the upstream helper needs, and it makes
 *   the server exercise `refStoreOf` / `repositoryFacadeOf` — the two adapters T9
 *   also consumes — rather than a bespoke `as unknown as History` mock.
 * - **Requests are recorded.** {@link InProcessGitServer.requests} is what lets a test
 *   assert that credentials reached the wire, which is the other half of asserting
 *   they never reached the disk.
 */

import { Git } from "@statewalker/vcs-commands";
import type { RefStore } from "@statewalker/vcs-transport";
import { createFetchHandler } from "@statewalker/vcs-transport";
import type { FilesApi } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { refStoreOf } from "../../src/adapters/ref-store.js";
import { repositoryFacadeOf } from "../../src/adapters/repository-facade.js";
import { openGitRepo } from "../../src/runtime/git-assembly.js";

/** One request the server was asked to serve. */
export interface ServedRequest {
  method: string;
  url: string;
  /** The `Authorization` header as sent, or `undefined` when there was none. */
  authorization?: string;
}

export interface InProcessGitServer {
  /** The absolute URL of the served repository — hand this to `remotes.addHttp`. */
  readonly url: string;
  /** The server-side repository. Assert a push against **this**, never against the push result. */
  readonly git: Git;
  /** The server-side refs, as the transport sees them. */
  readonly refStore: RefStore;
  /** The filesystem the server-side `.git` lives on. */
  readonly files: FilesApi;
  /** Every request served, oldest first. */
  readonly requests: ServedRequest[];
  /** Serve one Fetch-API `Request`. */
  handle(request: Request): Promise<Response>;
  /**
   * An injectable `fetch`, shaped for `VcsDeps.fetch`.
   *
   * Accepts both call styles. A `Request` handed over on its own is forwarded
   * **intact**: rebuilding it as `new Request(input.url)` drops the POST body, the
   * handler then sees a body-less request and answers **405**, and the failure
   * looks like a protocol bug rather than a mock bug.
   */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface InProcessGitServerOptions {
  /** Origin of the served URL. Default `http://git.test`. */
  baseUrl?: string;
  /** Path of the served repository. Default `/demo.git`. */
  repoPath?: string;
}

export async function createInProcessGitServer(
  options: InProcessGitServerOptions = {},
): Promise<InProcessGitServer> {
  const baseUrl = options.baseUrl ?? "http://git.test";
  const repoPath = options.repoPath ?? "/demo.git";

  const files = new MemFilesApi();
  const git = await openGitRepo(files, { create: true });
  const refStore = refStoreOf(historyOfOrThrow(git));
  const repository = repositoryFacadeOf(git);

  const handle = createFetchHandler({
    async resolveRepository(path) {
      return path ? { repository, refStore } : null;
    },
  });

  const requests: ServedRequest[] = [];

  return {
    url: `${baseUrl}${repoPath}`,
    git,
    refStore,
    files,
    requests,
    handle,
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const request =
        input instanceof Request && init === undefined
          ? input
          : new Request(urlOf(input), withDuplex(init));
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.get("authorization") ?? undefined,
      });
      return handle(request);
    },
  };
}

/** Every ref the server holds, as a plain object — the assertion target for a push. */
export async function serverRefs(server: InProcessGitServer): Promise<Record<string, string>> {
  const refs: Record<string, string> = {};
  for (const [name, oid] of await server.refStore.listAll()) refs[name] = oid;
  return refs;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** Node requires `duplex: "half"` for a streaming request body; it is absent from `RequestInit`. */
function withDuplex(init?: RequestInit): RequestInit | undefined {
  if (!init?.body) return init;
  return { ...init, duplex: "half" } as RequestInit;
}

function historyOfOrThrow(git: Git) {
  const history = git.history;
  if (!history) throw new Error("in-process server: git has no history backend");
  return history;
}
