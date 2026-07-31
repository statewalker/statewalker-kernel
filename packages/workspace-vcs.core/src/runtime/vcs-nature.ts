import { EmptyCommitError, type Git, type Status } from "@statewalker/vcs-commands";
import { joinPath as concatPath, tryReadText, writeText } from "@statewalker/webrun-files";
import {
  DEFAULT_SYSTEM_FOLDER,
  type Project,
  ProjectAdapter,
  Secrets,
  type Workspace,
} from "@statewalker/workspace.core";
import { assertSupportedIndex } from "../adapters/unsupported-entries.js";
import { type VcsConfigData, VcsConfiguration, validateVcsConfig } from "../config/index.js";
import {
  addHttpRemote,
  DEFAULT_REMOTE,
  type FetchOutcome,
  fetchFromHttpRemote,
  fetchImplOf,
  type HttpRemote,
  httpRemoteUrl,
  listHttpRemotes,
  type PushOutcome,
  pushToHttpRemote,
  type RemoteCredentials,
  remoteCredentialsKey,
  UnknownRemoteError,
} from "../remotes/index.js";
import { openGitRepo } from "./git-assembly.js";
import { repoFilesOf } from "./repo-files.js";

/** The file whose presence means "there is a repository here" — see {@link VcsNature.exists}. */
const GIT_HEAD = ".git/HEAD";
/** Repository-local excludes, read by the worktree because it is built with `gitDir`. */
const INFO_EXCLUDE = ".git/info/exclude";

/**
 * The exclude pattern that keeps the workbench's own per-project state out of commits.
 *
 * **No trailing slash, and that is load-bearing.** `.project/` matches the directory
 * entry and nothing inside it: `IgnoreManager.getStatus` returns `CHECK_PARENT` for a
 * path under an ignored directory while `isIgnored` only reports `IGNORED`, and the
 * worktree walk recurses into the directory regardless. So `.project/` would leave
 * `.project/nature.vcs.json` and everything below it staged by `add(".")`.
 *
 * **Derived, not spelled out.** As a literal it was structurally independent of
 * `DEFAULT_SYSTEM_FOLDER` — which this file already imports, which
 * `VcsConfiguration.configPath()` uses, and which the generated comment below
 * interpolates. Change the constant and the comment inside `.git/info/exclude`
 * would have claimed one folder was excluded while the pattern excluded another.
 */
const PROJECT_EXCLUDE = DEFAULT_SYSTEM_FOLDER;

const EXCLUDE_BLOCK = `# Written by GitNature (@statewalker/workspace-vcs.core).
# '${DEFAULT_SYSTEM_FOLDER}' is the workbench's own per-project state — this nature's
# marker, the scanner's indexes, transaction state — and is not the project's source.
# Keep the pattern without a trailing slash: '${DEFAULT_SYSTEM_FOLDER}/' would exclude
# the directory entry but nothing under it.
${PROJECT_EXCLUDE}
`;

/** The HTTP transport the nature's remote operations run on. */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Everything the VCS nature cannot derive from a `Project`, injected once at
 * registration time so no adapter reads an ambient environment.
 *
 * Handed to {@link registerVcs}, which must pass it into the factory it registers —
 * `(project) => new VcsNature(project, deps)`. A factory that closes over nothing
 * leaves `deps` inert, and the failure is silent: `Adaptable.getAdapter` self-hosts a
 * class token, so a caller that forgets `registerVcs` still gets a `VcsNature`.
 * {@link VcsNature.requireDeps} is what turns that silence into an error.
 */
export interface VcsDeps {
  /** Injected rather than taken from `globalThis` so a host can supply its own agent
   * and so remote tests can run against an in-process server. */
  fetch: FetchFn;
  /** Where credentials live. Defaults to the workspace's own `Secrets` adapter; they
   * are never written to `nature.vcs.json`, `.git/config`, or any committed tree. */
  secrets?: Secrets;
}

/** A commit identity — a display name, never a credential. */
export interface Author {
  name: string;
  email: string;
}

/** One entry of {@link VcsNature.log}. */
export interface CommitInfo {
  /** The commit's object id. */
  id: string;
  message: string;
  author: Author;
  /** Author time, in seconds since the epoch — git's own unit. */
  timestamp: number;
  /** Parent commit ids; empty for the initial commit. */
  parents: string[];
}

/** Arguments to {@link VcsNature.commit}. */
export interface CommitOptions {
  message: string;
  /** Overrides the project's configured author for this one commit. */
  author?: Author;
}

/**
 * What {@link VcsNature.commit} reports.
 *
 * `id` is present exactly when `changed` is `true`. The pair exists because
 * "nothing to commit" is a normal outcome of a manual commit, not an error — the
 * porcelain signals it by throwing `EmptyCommitError`, and a nature whose result
 * type were `{commit: string}` could not express it at all.
 */
export interface CommitOutcome {
  changed: boolean;
  id?: string;
}

/** Arguments to {@link VcsRemotes.addHttp}. */
export interface AddHttpRemoteOptions {
  /** Stored in the workspace `Secrets`, never alongside the URL. */
  credentials?: RemoteCredentials;
}

/** Arguments to {@link VcsNature.push}. */
export interface PushOptions {
  /** Push this ref instead of the current branch, e.g. `refs/heads/main`. */
  ref?: string;
  /** Allow a non-fast-forward update. */
  force?: boolean;
}

/** The remote namespace of {@link VcsNature}. */
export interface VcsRemotes {
  /**
   * Record an HTTP(S) remote in `.git/config`; its credentials go to `Secrets`.
   *
   * `name` must match `[A-Za-z0-9][A-Za-z0-9._/-]*` and `url` must be an absolute
   * `http(s)` URL with no userinfo and no control characters — anything else raises
   * `InvalidRemoteNameError` / `InvalidRemoteUrlError` and writes nothing. The rules
   * are narrower than git's own because the config writer escapes a `"` and nothing
   * else: a newline in either argument starts a `.git/config` section that git then
   * honours, and whitespace or a quote in the name comes back renamed.
   *
   * **Known limit — a hand-written `.git/config` is rewritten, not edited.** The
   * writer re-serializes the whole file from a flat map, so on the first `addHttp`
   * this repository's config loses (a) every `#`/`;` comment, (b) every repeated
   * key but the last — notably a second `fetch` refspec, and the one dropped is
   * `+refs/heads/*:refs/remotes/origin/*` — and (c) numeric-looking values are
   * coerced (`007` becomes `7`). Remotes themselves always survive.
   */
  addHttp(name: string, url: string, options?: AddHttpRemoteOptions): Promise<void>;
  /** Every remote recorded in this repository's `.git/config`. */
  list(): Promise<HttpRemote[]>;
}

/**
 * The VCS nature of a project, as a façade project adapter — one handle for
 * "is this project under version control" ({@link exists}), "put it under version
 * control" ({@link init}), and the repository itself ({@link git}).
 *
 * The repository is a real `.git` inside the project directory, on the project-rooted
 * `FilesApi` from `repoFilesOf`, so one project's history is invisible to its siblings
 * and native git can read either.
 */
export class VcsNature extends ProjectAdapter {
  readonly #deps?: VcsDeps;
  #git?: Promise<Git>;

  constructor(project: Project, deps?: VcsDeps) {
    super(project);
    this.#deps = deps;
  }

  /** The injected dependencies, or throw naming the registration that was skipped. */
  requireDeps(): VcsDeps {
    if (!this.#deps) {
      throw new Error(
        "VcsNature has no dependencies: this workspace was never passed to " +
          "registerVcs(workspace, deps). Adapter tokens self-host, so an unregistered " +
          "VcsNature is constructed anyway — with every dependency missing.",
      );
    }
    return this.#deps;
  }

  private get config(): VcsConfiguration {
    return this.project.requireAdapter(VcsConfiguration);
  }

  /** `<project>/.git/HEAD` on the workspace filesystem. */
  private headPath(): string {
    return concatPath(this.path.replace(/^\/+|\/+$/g, ""), GIT_HEAD);
  }

  /**
   * Whether this project carries the VCS nature — i.e. whether `.git/HEAD` is there.
   *
   * `HEAD` and not `.git/index`: the staging store writes an index with no repository
   * behind it, so an index proves only that something once staged a file. `HEAD` is
   * written by the create path and is what any reader resolves a branch through.
   */
  exists(): Promise<boolean> {
    return this.filesApi.exists(this.headPath());
  }

  /**
   * Materialize the nature: create the `.git` (which also excludes the workbench's own
   * state from it — see {@link git}) and write the `nature.vcs.json` marker. Safe to
   * call on a project that already has a repository — the repository is then opened,
   * not overwritten.
   *
   * **Safe for the marker too: a second `init()` merges, it does not replace.** An
   * existing configuration is loaded first and `config` is layered over it, so
   * `init()` with no arguments is a no-op on the marker rather than a wipe of the
   * author and default remote a previous call stored. Naming a field replaces that
   * field only. A marker already on disk carrying a key the closed schema does not
   * declare makes this throw instead of silently repairing the file — the same
   * validation any other write goes through.
   *
   * **Nothing is created until the configuration has passed validation.** Opening
   * the repository first meant a rejected config left `.git/HEAD` behind, so
   * {@link exists} answered `true` while {@link VcsConfiguration.exists} — the file
   * this code calls the nature marker — answered `false`.
   */
  async init(config: Omit<VcsConfigData, "version"> = {}): Promise<void> {
    const previous = (await this.config.exists()) ? (await this.config.load()).data : undefined;
    const merged: VcsConfigData = { ...previous, ...config, version: 1 };
    validateVcsConfig(merged);
    await this.git();
    await this.config.write(merged);
  }

  /**
   * The repository, memoised for this adapter instance.
   *
   * **One project can nevertheless have more than one of these.** Adapter instances
   * are cached per `Project` handle and `Workspace._projects` is an LRU with a
   * one-hour default `maxAge`, so `getProject("a")` an hour later — or past 256
   * projects — hands back a *new* Project, a new `VcsNature`, a new `Git` and a new
   * staging store. Each holds its own in-memory index that `add()` writes out
   * wholesale, so `.git/index`, not this memo, is the shared truth. That is why
   * {@link add}, {@link commit} and {@link status} re-read it first — see
   * {@link refreshStaging}.
   *
   * `create` is decided by {@link exists}: the layout is laid down exactly once, and
   * every later call opens what is on disk.
   *
   * **The exclude is ensured here, not in {@link init}.** A `.git` made by native
   * `git init` — or one that predates this nature — never passes through `init()`,
   * so an exclude written there would leave exactly the repositories we advertise
   * compatibility with unprotected, and `add(".")` would commit `.project/**` (this
   * nature's marker, the scanner's indexes, transaction state) into the user's own
   * history. Ensuring it on every open costs one `tryReadText`, is append-idempotent
   * (see {@link writeInfoExclude}), and `init()` simply inherits it.
   *
   * **The memo caches a success, never a failure.** The promise is stored before it
   * settles — that is deliberate, and it is what makes concurrent callers share one
   * assembly rather than race two — but a rejection is then dropped from the memo, so
   * one transient `EIO` does not permanently kill an adapter that is itself cached on
   * a Project cached on the Workspace. The next call retries.
   */
  git(): Promise<Git> {
    if (!this.#git) {
      const opening = (async () => {
        const git = await openGitRepo(repoFilesOf(this.project), {
          create: !(await this.exists()),
        });
        await this.writeInfoExclude();
        return git;
      })();
      this.#git = opening;
      // Not `.catch(...)` on the memoised value: the caller's rejection must stay the
      // original one, and this handler only evicts. The identity check keeps a slow
      // failure from evicting a later, successful open.
      opening.catch(() => {
        if (this.#git === opening) this.#git = undefined;
      });
    }
    return this.#git;
  }

  /**
   * Stage everything matching `pathspec` (default: the whole worktree).
   *
   * Paths are relative to the project directory, because the repository lives on
   * the project-rooted `FilesApi` — `add("src")`, never `add("<project>/src")`.
   * `.project` is skipped because {@link git} ensures it in `.git/info/exclude` on
   * every open — including on a repository this nature never created.
   *
   * **Raises `UnsupportedEntryError` rather than staging a mode regression.** This
   * is the call that would corrupt: `AddCommand` stages the worktree's reported
   * mode, and `FileWorktree.getFileMode` reports `REGULAR_FILE` for everything, so
   * an adopted repository's `100755` entries would silently become `100644` and its
   * symlinks would become regular files holding their targets' bytes. See
   * {@link assertSupportedIndex}.
   */
  async add(pathspec = "."): Promise<void> {
    const git = await this.git();
    await refreshStaging(git);
    // Before staging: `add` is what rewrites the mode, and afterwards the true
    // mode is gone from the only place that recorded it.
    await assertSupportedIndex(git);
    await git.add().addFilepattern(pathspec).call();
  }

  /**
   * Record the staged tree as a commit — the **only** place in this nature where
   * a commit is created. There are no timers, watchers, subscriptions or
   * autosave anywhere in it; nothing observes the worktree, so nothing can
   * commit behind the caller's back.
   *
   * "Nothing to commit" is reported as `{changed: false}`, not raised, because
   * on a manually committed repository it is an ordinary outcome. Two distinct
   * cases produce it, and the porcelain only covers one:
   *
   * - **With history** — `CommitCommand` compares the staged tree to the parent's
   *   and throws `EmptyCommitError`, which is caught here.
   * - **Without history** — that guard is gated on `parents.length > 0`, so on a
   *   repository straight out of {@link init} an empty index would commit
   *   happily. The pre-check below is what closes that.
   *
   * The pre-check asks both questions ("no HEAD commit" *and* "empty index")
   * rather than "empty index" alone: an empty index against a non-empty HEAD is
   * a staged deletion of the whole tree, which is a real change and must commit.
   *
   * **Known limit — a repository holding a symlink, a gitlink or an executable is
   * refused**, with `UnsupportedEntryError`. Not a mode this nature can carry: see
   * {@link assertSupportedIndex} for the upstream cause and why refusing beats the
   * silent, irreversible alternative. Detection reads the index, so an *untracked*
   * symlink or executable is not seen.
   */
  async commit(opts: CommitOptions): Promise<CommitOutcome> {
    const git = await this.git();
    await refreshStaging(git);
    await assertSupportedIndex(git);
    if (!(await headCommitOf(git)) && (await stagedEntryCount(git)) === 0) {
      return { changed: false };
    }

    const command = git.commit().setMessage(opts.message);
    const author = opts.author ?? (await this.configuredAuthor());
    if (author) command.setAuthor(author.name, author.email);

    try {
      const { id } = await command.call();
      return { changed: true, id };
    } catch (error) {
      if (error instanceof EmptyCommitError) return { changed: false };
      throw error;
    }
  }

  /**
   * The commits reachable from HEAD, newest first.
   *
   * Empty — not an error — on a repository with no commits. `LogCommand`
   * resolves HEAD first and throws `NoHeadError` there, but "no history yet" is
   * a state a freshly initialized project is legitimately in.
   */
  async log(opts: { max?: number } = {}): Promise<CommitInfo[]> {
    const git = await this.git();
    if (!(await headCommitOf(git))) return [];

    const command = git.log();
    if (opts.max !== undefined) command.setMaxCount(opts.max);

    const commits: CommitInfo[] = [];
    for await (const commit of await command.call()) {
      commits.push({
        id: commit.id,
        message: commit.message,
        author: { name: commit.author.name, email: commit.author.email },
        timestamp: commit.author.timestamp,
        parents: [...commit.parents],
      });
    }
    return commits;
  }

  /**
   * The staging index compared against HEAD — `added` / `changed` / `removed` /
   * `conflicting`.
   *
   * **Not the worktree.** `StatusCommand` reads the index and the HEAD tree and
   * nothing else, and `Status` has no `untracked` field, so a file written
   * through the `FilesApi` and never staged does not appear here. Surfacing
   * untracked files would mean a `StatusCalculator` with `includeUntracked`,
   * which this nature deliberately does not do.
   */
  async status(): Promise<Status> {
    const git = await this.git();
    await refreshStaging(git);
    return git.status().call();
  }

  /**
   * The project's HTTP remotes, as recorded in its own `.git/config`.
   *
   * A namespace rather than four more methods on the façade, so `remotes.list()`
   * reads as what it is and leaves room for `remove` later without crowding
   * `add`/`commit`/`log`/`status`.
   */
  get remotes(): VcsRemotes {
    return {
      addHttp: async (name: string, url: string, options: AddHttpRemoteOptions = {}) => {
        await this.requireRepository("addHttp");
        await addHttpRemote(repoFilesOf(this.project), name, url);
        // After the URL is on disk, so a rejected URL never leaves a dangling secret.
        if (options.credentials) await this.storeCredentials(name, options.credentials);
      },
      list: async () => {
        await this.requireRepository("remotes.list");
        return listHttpRemotes(repoFilesOf(this.project));
      },
    };
  }

  /**
   * Send a branch to `remote` — by default the branch HEAD is on, to the project's
   * configured `defaultRemote` (or `origin` when it declares none).
   *
   * `remote` is a **name**, resolved here against this repository's own
   * `.git/config`. That resolution is the reason the porcelain is not used:
   * `PushCommand.resolveRemoteUrl()` returns its input unchanged whenever it holds
   * neither `://` nor `@`, so `push("origin")` reaches `new Request("origin/info/refs?…")`
   * and dies with `TypeError: Failed to parse URL`. An unknown name here raises
   * {@link UnknownRemoteError} before any request exists.
   */
  async push(remote?: string, options: PushOptions = {}): Promise<PushOutcome> {
    const git = await this.requireRepository("push");
    const name = remote ?? (await this.defaultRemote());
    const url = await this.requireRemoteUrl(name);

    const ref = options.ref ?? (await currentBranchRef(git));
    if (!(await headCommitOf(git, ref))) {
      throw new Error(`push: ${ref} has no commit yet — commit before pushing`);
    }

    return pushToHttpRemote({
      git,
      url,
      ref,
      force: options.force,
      auth: await this.credentialsFor(name),
      fetchImpl: fetchImplOf(this.requireDeps().fetch),
    });
  }

  /**
   * Bring `remote`'s branches into this repository as `refs/remotes/<remote>/*`.
   *
   * Objects are imported, not merely advertised — and nothing on the local branch
   * moves. Fetch is not merge; this nature has no merge surface.
   */
  async fetch(remote?: string): Promise<FetchOutcome> {
    const git = await this.requireRepository("fetch");
    const name = remote ?? (await this.defaultRemote());
    const url = await this.requireRemoteUrl(name);

    return fetchFromHttpRemote({
      git,
      url,
      remote: name,
      auth: await this.credentialsFor(name),
      fetchImpl: fetchImplOf(this.requireDeps().fetch),
    });
  }

  /**
   * The repository, but only if one is already there.
   *
   * {@link git} *creates* on first call, which is right for `init()` and wrong for
   * everything a remote operation does — `remotes.addHttp` on a project with no
   * `.git` would otherwise silently make one as a side effect of recording a URL.
   */
  private async requireRepository(operation: string): Promise<Git> {
    if (!(await this.exists())) {
      throw new Error(`${operation}: no repository at '${this.path}' — call init() first`);
    }
    return this.git();
  }

  /**
   * The remote {@link push} and {@link fetch} target when the caller names none:
   * the project's configured `defaultRemote`, or `origin`.
   *
   * Read here rather than hardcoded because the field is documented as exactly
   * this, is validated by the closed schema, and is persisted — and reading it
   * nowhere meant `init({defaultRemote:"upstream"})` followed by a bare `push()`
   * failed with `unknown remote 'origin'`, naming a remote the project never
   * declared.
   */
  private async defaultRemote(): Promise<string> {
    const config = this.config;
    if (!(await config.exists())) return DEFAULT_REMOTE;
    return (await config.load()).data.defaultRemote ?? DEFAULT_REMOTE;
  }

  /** A remote's URL, or {@link UnknownRemoteError}. */
  private async requireRemoteUrl(remote: string): Promise<string> {
    const url = await httpRemoteUrl(repoFilesOf(this.project), remote);
    if (!url) throw new UnknownRemoteError(remote);
    return url;
  }

  /**
   * The workspace's secret store, or `undefined` when this workspace has none.
   *
   * The `getAdapter` guard is the same trap {@link requireDeps} documents: adapter
   * tokens self-host, and `Secrets` is abstract only in TypeScript — at runtime an
   * unconfigured workspace happily constructs one with no method bodies at all. A
   * duck-type check turns that into "no store" instead of a `TypeError` deep inside
   * a push.
   */
  private secretsStore(): Secrets | undefined {
    const injected = this.requireDeps().secrets;
    if (injected) return injected;
    const adapter = this.workspace.getAdapter(Secrets);
    return typeof adapter?.get === "function" ? adapter : undefined;
  }

  private async storeCredentials(remote: string, credentials: RemoteCredentials): Promise<void> {
    const secrets = this.secretsStore();
    if (!secrets) {
      throw new Error(
        `addHttp: credentials were given for '${remote}' but this workspace has no Secrets ` +
          "adapter — pass one as registerVcs(workspace, { fetch, secrets }) or run initWorkspace(). " +
          "Credentials are never written to .git/config.",
      );
    }
    await secrets.set(remoteCredentialsKey(this.path, remote), credentials);
  }

  /** A remote's credentials from `Secrets`, or `undefined` for an anonymous remote. */
  private async credentialsFor(remote: string): Promise<RemoteCredentials | undefined> {
    const secrets = this.secretsStore();
    if (!secrets) return undefined;
    const stored = await secrets.get(remoteCredentialsKey(this.path, remote));
    if (!stored || typeof stored !== "object") return undefined;
    const { username, password } = stored as Partial<RemoteCredentials>;
    if (typeof username !== "string" || typeof password !== "string") return undefined;
    return { username, password };
  }

  /** The project's declared commit identity, if it has one. */
  private async configuredAuthor(): Promise<Author | undefined> {
    const config = this.config;
    if (!(await config.exists())) return undefined;
    return (await config.load()).author;
  }

  /** Append the `.project` exclude, once, preserving anything already in the file. */
  private async writeInfoExclude(): Promise<void> {
    const files = repoFilesOf(this.project);
    const existing = (await tryReadText(files, INFO_EXCLUDE)) ?? "";
    if (existing.split("\n").some((line) => line.trim() === PROJECT_EXCLUDE)) return;
    const prefix = existing === "" || existing.endsWith("\n") ? existing : `${existing}\n`;
    await files.mkdir(".git/info");
    await writeText(files, INFO_EXCLUDE, `${prefix}${EXCLUDE_BLOCK}`);
  }
}

/**
 * The commit a ref points at, or `undefined` when it resolves to nothing.
 *
 * The same resolution the porcelain does before it raises `NoHeadError`, asked as
 * a question instead: `.git/HEAD` names a branch from the moment the repository is
 * created, but that branch ref does not exist until the first commit writes it.
 */
async function headCommitOf(git: Git, ref = "HEAD"): Promise<string | undefined> {
  const history = git.history;
  if (!history) throw new Error("no history on the Git façade");
  return (await history.refs.resolve(ref))?.objectId;
}

/**
 * The branch ref HEAD names, e.g. `refs/heads/main`.
 *
 * Read from `.git/HEAD` rather than assumed: it is a symbolic ref from the moment
 * the repository is created, and it is what a push has to name as its source. A
 * detached HEAD has no branch to push, and saying so beats pushing the wrong ref.
 */
async function currentBranchRef(git: Git): Promise<string> {
  const history = git.history;
  if (!history) throw new Error("no history on the Git façade");
  const head = await history.refs.get("HEAD");
  if (!head || !("target" in head)) {
    throw new Error("push: HEAD is detached — pass { ref } to name the ref to push");
  }
  return head.target;
}

/**
 * Re-read `.git/index` into the staging store before answering from it.
 *
 * The staging store keeps the index in memory and `add()` writes it out **wholesale**,
 * so a second live handle on the same project — which the `Workspace` LRU hands out
 * routinely, see {@link VcsNature.git} — would otherwise overwrite entries it never
 * saw, silently dropping the other handle's staged work, and would answer `status()`
 * from a snapshot the file no longer matches.
 *
 * Unconditional, not gated on `isOutdated()`: this runs once per call, the read is one
 * file, and the gate would reintroduce exactly the staleness it is meant to close. It
 * loses nothing in flight either — the previous `add()` already persisted.
 */
async function refreshStaging(git: Git): Promise<void> {
  const checkout = git.checkoutState;
  if (!checkout) throw new Error("no checkout on the Git façade");
  await checkout.staging.read();
}

/** How many entries the staging index holds, across all merge stages. */
async function stagedEntryCount(git: Git): Promise<number> {
  const checkout = git.checkoutState;
  if (!checkout) throw new Error("no checkout on the Git façade");
  return checkout.staging.getEntryCount();
}

/** Resolve the VCS nature from a project (mirrors `vcsConfigOf`). */
export function vcsNatureOf(project: Project): VcsNature {
  return project.requireAdapter(VcsNature);
}

/**
 * One-call setup: register the VCS nature's project adapters on a workspace.
 *
 * Registers **both** the façade and the configuration it writes — `VcsNature` alone
 * would leave `vcsConfigOf` self-hosting an adapter nothing configured. Mirrors
 * `registerWiki`, which registers `WikiNature` alongside `WikiLlmConfiguration`.
 */
export function registerVcs(workspace: Workspace, deps: VcsDeps): void {
  const registry = workspace.adaptersRegistry;
  registry.register(
    "project",
    VcsConfiguration,
    (project: Project) => new VcsConfiguration(project),
  );
  registry.register("project", VcsNature, (project: Project) => new VcsNature(project, deps));
}
