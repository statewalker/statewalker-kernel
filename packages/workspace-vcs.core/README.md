# @statewalker/workspace-vcs.core

## What it is

Git version control as an opt-in nature of a workspace project (a `Project` from `@statewalker/workspace.core`). Each versioned project gets its own real `.git` directory inside the project folder, written with `@statewalker/vcs-store-files`, so command-line `git` can read it. Commits are manual: nothing is committed until `commit()` is called. The `VcsNature` project adapter covers init, add, commit, log, status, HTTP(S) remotes, push and fetch. Terms and the full list of known limits are in [CONTEXT.md](./CONTEXT.md).

## Why it exists

The `@statewalker/vcs-*` packages implement git over a `FilesApi`, and `@statewalker/vcs-workspace` keeps the file side and the history side apart. A workbench project needs the two joined: a repository that lives in the project folder, sees only that project's files, keeps the workbench's own `.project/` state out of history, stores remote credentials somewhere other than `.git/config`, and refuses operations that would silently damage a repository created by native git. This package is that join. It uses the vcs packages as they are and does not modify them.

## How to use

```sh
pnpm add @statewalker/workspace-vcs.core
```

No peer dependencies. One entry point, `@statewalker/workspace-vcs.core`, ESM with `.d.ts`. It works over any `FilesApi` backend (memory, Node, browser); remote operations use the `fetch` function you pass to `registerVcs`. The package ships `dist/`, `src/` and `CONTEXT.md`.

```ts
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { initWorkspace, Workspace } from "@statewalker/workspace.core";
import { registerVcs, vcsNatureOf } from "@statewalker/workspace-vcs.core";

// initWorkspace also installs the Secrets adapter used for remote credentials.
const workspace = initWorkspace({
  workspace: new Workspace(),
  filesApi: new MemFilesApi({ initialFiles: { "notes/README.md": "# Notes" } }),
});
registerVcs(workspace, { fetch: globalThis.fetch.bind(globalThis) });

const project = await workspace.getProject("notes");
if (!project) throw new Error("no project");
const vcs = vcsNatureOf(project);

await vcs.init({ author: { name: "Ada", email: "ada@example.com" } });
await vcs.add();
const { changed, id } = await vcs.commit({ message: "First commit" });
```

## Examples

History and status:

```ts
const commits = await vcs.log({ max: 10 }); // [{ id, message, author, timestamp, parents }]
const status = await vcs.status(); // Status from @statewalker/vcs-commands
```

A remote with credentials, then push and fetch:

```ts
await vcs.remotes.addHttp("origin", "https://git.example.com/notes.git", {
  credentials: { username: "ada", password: "..." }, // stored in Secrets, not in .git/config
});
const pushed = await vcs.push(); // { url, ok, updates }
const fetched = await vcs.fetch("origin"); // { url, updated, objectsImported }
const remotes = await vcs.remotes.list(); // [{ name, url }]
```

`push()` and `fetch()` without a name use `defaultRemote` from the project configuration, then `"origin"`. `push(remote, { ref, force })` pushes another ref or allows a non-fast-forward update.

Reading the project configuration:

```ts
import { vcsConfigOf } from "@statewalker/workspace-vcs.core";

const config = await vcsConfigOf(project).load();
config.author; // { name, email } | undefined
```

Using the repository directly:

```ts
import { createGitRepository, hashContentSha256, repoFilesOf } from "@statewalker/workspace-vcs.core";

const git = await vcs.git(); // Git from @statewalker/vcs-commands
const repository = createGitRepository(git, repoFilesOf(project), hashContentSha256);
const head = await repository.head();
```

## Internals

### Where things live

```
<workspace>/
  notes/                       a Project
    .git/                      the repository (native layout, branch "main")
      config                   remotes: remote.<name>.url
      info/exclude             contains .project
    .project/nature.vcs.json   { version: 1, defaultRemote?, author? }
    README.md
workspace Secrets adapter      vcs.remote.<project path>.<remote> -> { username, password }
```

The repository sees the project through `repoFilesOf(project)`: the workspace `FilesApi` re-rooted at the project folder, with any path containing a `..` segment hidden. Two projects in one workspace therefore have independent repositories.

### Design decisions

- **The repository is assembled explicitly, file-backed.** `openGitRepo` builds objects, refs and `HEAD` under `.git` with `createGitFilesBackend`. The porcelain `Git.init()` keeps history in memory, so a commit made through it would not survive the process.
- **The branch is always `main`.** The working copy from `@statewalker/vcs-working-tree` hard-codes `refs/heads/main` and does not read `.git/HEAD`; any other initial branch would make a reopened repository resolve the wrong ref.
- **`.project` is excluded on every open, not only in `init()`.** A `.git` created by native git never passes through `init()`, and without the exclude `add(".")` would commit the workbench's state.
- **Remotes are written to `.git/config` directly** (through `GitWorkingCopyConfig`), because the porcelain's `remoteAdd` does not persist anything and `remoteList` always returns no URLs.
- **`exists()` checks `.git/HEAD`, not `.git/index`**, because the staging store can write an index with no repository behind it.
- **`add`, `commit` and `status` re-read `.git/index` first.** The workspace's project cache can hand out a second `Project` (and a second `VcsNature`) for the same folder, so the file on disk, not an in-memory index, is shared.
- **Nothing is committed in the background.** The nature registers no builders.

### What breaks

| Situation | What you see |
| --- | --- |
| A symlink, gitlink or executable in the index during `add`/`commit` | `UnsupportedEntryError`: `unsupported entry '<path>': the index records mode 120000 (...)`; nothing is staged |
| `commit` with nothing staged | `{ changed: false }`, no error |
| Remote operation before `init()` | `addHttp: no repository at '<path>' — call init() first` (same for `remotes.list`, `push`, `fetch`) |
| Unknown remote name | `UnknownRemoteError`: `unknown remote 'x': no remote.x.url in .git/config. Add it with remotes.addHttp(name, url) first.` |
| Bad remote name or URL | `InvalidRemoteNameError` / `InvalidRemoteUrlError`; nothing is written |
| `push` before the first commit | `push: refs/heads/main has no commit yet — commit before pushing` |
| Credentials but no `Secrets` adapter | `addHttp: credentials were given for 'origin' but this workspace has no Secrets adapter — ...` |
| Remote operation without `registerVcs` | `VcsNature has no dependencies: this workspace was never passed to registerVcs(workspace, deps). ...` (the class self-hosts, so the adapter exists without its `fetch`) |

`add`, `commit`, `log`, `status` and `git()` do not require `init()`: on a project without `.git` they create one, without writing `nature.vcs.json`.

Other limits, detailed in [CONTEXT.md](./CONTEXT.md#known-limits): untracked symlinks and executables are added as regular files; the first `remotes.addHttp` on a hand-written `.git/config` drops comments and repeated keys; checkout never deletes files; `hasChanges()` reads the whole working tree; nested repositories are skipped.

### API reference

- Runtime: `registerVcs(workspace, deps)`, `VcsDeps` (`fetch`, `secrets?`), `VcsNature`, `vcsNatureOf`, `VcsRemotes`, `Author`, `CommitInfo`, `CommitOptions`, `CommitOutcome`, `AddHttpRemoteOptions`, `PushOptions`, `FetchFn`, `repoFilesOf`, `openGitRepo`, `OpenGitRepoOptions`.
- Configuration: `VcsConfiguration`, `vcsConfigOf`, `VcsConfigData`, `validateVcsConfig`, `VCS_NATURE_FILE`.
- Remotes: `addHttpRemote`, `listHttpRemotes`, `httpRemoteUrl`, `pushToHttpRemote`, `fetchFromHttpRemote`, `fetchImplOf`, `remoteUrlKey`, `remoteCredentialsKey`, `CONFIG_PATH`, `DEFAULT_REMOTE`, `UnknownRemoteError`, `InvalidRemoteNameError`, `InvalidRemoteUrlError`, `HttpRemote`, `RemoteCredentials`, `PushOutcome`, `RefPushOutcome`, `FetchOutcome`, `PushToHttpRemoteOptions`, `FetchFromHttpRemoteOptions`.
- Adapters for `@statewalker/vcs-workspace`: `createGitRepository`, `trackedFilesOf`, `createHttpGitRemote`, `createDuplexGitRemote`, `pushTargetsOf`, `httpRefspecOf`, `duplexRefspecOf`, `httpPushOutcome`, `duplexPushOutcome`, `RemotePushError`, `HttpGitRemoteOptions`, `DuplexGitRemoteOptions`, `PushTarget`, `refStoreOf`, `historyOf`, `serializationOf`, `repositoryFacadeOf`, `configFilesOf`, `UnsupportedEntryError`, `assertSupportedEntry`, `assertSupportedIndex`.
- Hashing: `hashContentSha256`, `HashContent`, `ByteStream`.

### Dependencies

- `@statewalker/workspace.core` - `Project`, `ProjectAdapter`, `Secrets`, the adapter registry.
- `@statewalker/vcs-core`, `vcs-commands`, `vcs-store-files`, `vcs-working-tree` - git objects, porcelain, the file-backed `.git` and the worktree.
- `@statewalker/vcs-workspace` - the `Repository` contract that `createGitRepository` implements.
- `@statewalker/vcs-transport`, `vcs-transport-adapters` - git smart-HTTP push and fetch.
- `@statewalker/webrun-files`, `webrun-files-composite` - the `FilesApi` contract and the re-rooted, filtered project view.

## License

MIT
