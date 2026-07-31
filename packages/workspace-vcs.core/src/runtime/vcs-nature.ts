import type { Git, Status } from "@statewalker/vcs-commands";
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

  /** Stage everything matching `pathspec` (default: the whole worktree). */
  async add(_pathspec = "."): Promise<void> {
    throw new Error("not implemented");
  }

  /** Record the staged tree as a commit. */
  async commit(_opts: CommitOptions): Promise<CommitOutcome> {
    throw new Error("not implemented");
  }

  /** The commits reachable from HEAD, newest first. */
  async log(_opts: { max?: number } = {}): Promise<CommitInfo[]> {
    throw new Error("not implemented");
  }

  /** The staging index compared against HEAD. */
  async status(): Promise<Status> {
    throw new Error("not implemented");
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
