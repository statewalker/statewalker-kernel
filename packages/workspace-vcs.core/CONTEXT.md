# GitNature (workbench integration)

The language of version control as it lives inside the workbench: a versioned
project is a Project in the opened Workspace carrying the **vcs nature**, backed
by a **real `.git`** that native git can read, and committed **only when a person
asks for it**.

## Language

**GitNature** (the package `@statewalker/workspace-vcs.core`):
The workbench-side façade that gives a **Project** version control. It links the
two axes the upstream `@statewalker/vcs-workspace` package deliberately keeps
apart — the file axis and the history axis — which is why it lives here and not
upstream. Upstream `vcs-workspace` source is a **dependency, never a modification
target**.
_Avoid_: git module, vcs plugin.

**Nature** (cf. Eclipse project natures):
A marker on a **Project** that associates it with a toolchain and activates that
toolchain's adapters. The substrate treats *every* top-level directory as a
Project; a Project becomes versioned only by carrying the vcs nature. The nature
is materialized by the project's vcs config (`.project/nature.vcs.json`) and
reached through one façade project adapter, `VcsNature`
(`project.requireAdapter(VcsNature)`).
_Avoid_: type, kind, flavor.

**Workspace**:
The single root directory the user opens; the substrate that hosts Projects,
Resources, and adapters. Its `FilesApi` spans the whole workspace.

**Project-rooted `FilesApi`**:
The view of the workspace `FilesApi` restricted to one project's subtree
(`new CompositeFilesApi(workspace.files, project.path)`), and the only files
handle the repository ever sees. **Private to this package** — deliberately not
promoted to `workspace.core` as `project.files`, to keep the blast radius at
zero. Two projects in one workspace therefore get **independent** repositories.
_Avoid_: scoped files, sub-files.

**Repository**:
One project's `.git` — a **real, native-git-compatible** directory written by
`@statewalker/vcs-store-files`, not an in-memory or bespoke history store. The
locked premise of this feature: whatever the workbench writes, `git log` on the
command line must be able to read.
_Avoid_: store, history db.

**Manual commit**:
The commit discipline. There is **no background writer and no autosave-to-commit** —
a commit happens when, and only when, `commit()` is called. A `commit()` with
nothing staged reports `changed: false` rather than fabricating an empty commit.
Because nothing needs to observe working-tree changes, GitNature registers **no
builders**; `ProjectBuilder.scan()` hard-skips dot-segments anyway, so `.git/`
can never arrive as a build signal.
_Avoid_: autosave, checkpoint.

**Remote**:
A named HTTP endpoint for `push` / `fetch`, stored **in `.git/config`** — because
storing it anywhere else would make the repo unreadable to native git. Written
through `GitWorkingCopyConfig`, **not** through the porcelain's `remoteAdd` /
`remoteList`: `RemoteAddCommand.storeRemoteConfig()` is an empty method body and
`RemoteListCommand` scans `refs/remotes/` and hard-codes `urls: []`, so after
`remoteAdd().call()` the config file is unchanged and `remoteList().call()`
returns `[]`. A remote name is resolved to a URL **here**, before any request is
built — the porcelain would hand `"origin"` straight to `new Request()`.
_Avoid_: origin (that is one remote's name, not the concept).

**Credentials**:
Authentication material for a **Remote**. They live in the workspace-level
`Secrets` adapter and **nowhere else** — never in `nature.vcs.json`, never in
`.git/config`, never in a committed tree, never in a test fixture. The same rule
`wiki.core` states for **Connection** credentials.
_Avoid_: token, password (name the concept, then the store).

**Vcs configuration** (`.project/nature.vcs.json`):
The nature marker plus workbench-side settings — and **only** those. Follows
`WikiLlmConfiguration`: `exists()` / `load()` / `write()` / `data`, with the
**load-before-sync-getters** contract, written atomically. Repository state
proper (refs, remotes, objects) lives in `.git`, not here.
_Avoid_: repo config (that is `.git/config`).

## Relationships

- A **Workspace** contains zero or more versioned **Projects**, each with its own
  **Repository**, isolated by its **project-rooted `FilesApi`**
- A **Project**'s vcs nature is reached through one façade adapter, `VcsNature`,
  registered by `registerVcs(workspace, deps)` — adapters read no environment
- **Remotes** live in `.git/config`; their **Credentials** live in `Secrets`; the
  **Vcs configuration** holds neither
- **GitNature** depends on `@statewalker/vcs-workspace` and never modifies it

## Known limits

Things this package **refuses to do** or **cannot do**, stated here because the
alternative to stating them is a caller discovering them from corrupted history.

**Symlinks, gitlinks and executables are refused, not carried.**
`VcsNature.add`, `VcsNature.commit`, and the `Repository` adapter's `hasChanges()`
and `commit()` all raise `UnsupportedEntryError` when the index records a mode
other than `100644`. Nothing is staged and the repository is left exactly as it
was found.

The cause is upstream and out of this feature's bounds:
`FileWorktree.getFileMode` in `@statewalker/vcs-store-files` returns
`FileMode.REGULAR_FILE` for **every** path, unconditionally, and `AddCommand`
stages what the worktree reports. Measured against git 2.43.0 on a repository
created by native git:

- **Executable** — `add(".")` rewrites `100755` to `100644` in the index and the
  next commit records it gone from history. `git fsck --strict` exits 0 with
  empty output; it does not flag this.
- **Symlink** — `Worktree.computeHash` follows the link and hashes its *target*,
  which can never equal the `120000` blob. So `hasChanges()` answers `true` on a
  repository `git status` calls clean, `commitOnlyWhenChanged` therefore commits,
  and that commit replaces the link in history with a **regular file holding the
  target's bytes**. Irreversible.

Refusal was chosen over both alternatives: fixing `getFileMode` means editing
`store-files`, which this feature's contract hard-bans, and degrading silently is
worse than an error. Lifting the limit is a follow-up on `store-files`.

**The guard is index-based, so an untracked entry is invisible to it.** The index
is the only place a true mode survives — a native `git add` wrote it there — and
the worktree view reports `REGULAR_FILE` for everything. A symlink or executable
that has never been staged is therefore not detected, and `add(".")` would take it
in as a regular file.

## Flagged ambiguities

- `@statewalker/workspace-vcs.core` and `@statewalker/workspace.core` differ only
  by dot-vs-hyphen, and this package imports the latter. Accepted deliberately in
  exchange for a name that says what the package does.
- "workspace" names two different things: the workbench **Workspace** (the opened
  root directory) and git's working tree. Use **working tree** for the latter.
- "nature" is both the marker file and the adapter façade — resolved: the file
  `.project/nature.vcs.json` *materializes* the nature, `VcsNature` *is* how you
  use it.
