import { EmptyCommitError, type Git, type Status } from "@statewalker/vcs-commands";
import { joinPath as concatPath, tryReadText, writeText } from "@statewalker/webrun-files";
import {
  DEFAULT_SYSTEM_FOLDER,
  type Project,
  ProjectAdapter,
  type Secrets,
  type Workspace,
} from "@statewalker/workspace.core";
import { type VcsConfigData, VcsConfiguration } from "../config/index.js";
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
 */
const PROJECT_EXCLUDE = ".project";

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
   * Materialize the nature: create the `.git`, exclude the workbench's own state from
   * it, and write the `nature.vcs.json` marker. Safe to call on a project that already
   * has a repository — the repository is then opened, not overwritten.
   */
  async init(config: Omit<VcsConfigData, "version"> = {}): Promise<void> {
    await this.git();
    await this.writeInfoExclude();
    await this.config.write({ version: 1, ...config });
  }

  /**
   * The repository, memoised for this adapter instance (and adapter instances are
   * themselves cached per project handle, so one project has one repository).
   *
   * `create` is decided by {@link exists}: the layout is laid down exactly once, and
   * every later call opens what is on disk.
   */
  git(): Promise<Git> {
    if (!this.#git) {
      this.#git = (async () =>
        openGitRepo(repoFilesOf(this.project), { create: !(await this.exists()) }))();
    }
    return this.#git;
  }

  /**
   * Stage everything matching `pathspec` (default: the whole worktree).
   *
   * Paths are relative to the project directory, because the repository lives on
   * the project-rooted `FilesApi` — `add("src")`, never `add("<project>/src")`.
   * `.project` is skipped because {@link init} wrote it to `.git/info/exclude`.
   */
  async add(pathspec = "."): Promise<void> {
    const git = await this.git();
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
   */
  async commit(opts: CommitOptions): Promise<CommitOutcome> {
    const git = await this.git();
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
    return git.status().call();
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
 * The commit HEAD points at, or `undefined` when the repository has no commits.
 *
 * The same resolution the porcelain does before it raises `NoHeadError`, asked as
 * a question instead: `.git/HEAD` names a branch from the moment the repository is
 * created, but that branch ref does not exist until the first commit writes it.
 */
async function headCommitOf(git: Git): Promise<string | undefined> {
  const history = git.history;
  if (!history) throw new Error("no history on the Git façade");
  return (await history.refs.resolve("HEAD"))?.objectId;
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
