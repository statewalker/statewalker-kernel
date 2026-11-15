---
"@statewalker/explorer.core": minor
"@statewalker/mime.core": minor
"@statewalker/platform.browser": minor
"@statewalker/platform.core": minor
"@statewalker/platform.node": minor
"@statewalker/render.core": minor
"@statewalker/webapp.browser": minor
"@statewalker/webapp.core": minor
"@statewalker/workspace-vcs.core": minor
"@statewalker/workspace.browser": minor
"@statewalker/workspace.core": minor
---

**Move to `@statewalker/webrun-files` 0.12, with the webrun-sites and webrun-vcs releases built on it.** The dependency ranges move:
- webrun-files, -browser, -composite, -mem and -node go to ^0.12.0;
- webrun-builder goes to ^0.5.0, webrun-modules to ^0.4.0, webrun-site-builder to ^0.3.0 and webrun-site-host to ^0.4.0;
- the `@statewalker/vcs-*` packages go to ^0.4.0.

These are breaking lines. webrun-files 0.12 resolves `..` segments before any filter, guard or mount sees a path, and throws `Path climbs above the root` above the root.

**workspace-vcs.core** moves to vcs-transport 0.4's push and fetch clients:
- `pushToHttpRemote` and the HTTP `GitRemote` call `push()` with `repository`/`refStore`, since `httpPush` is gone.
- `fetchFromHttpRemote` lets the fetch client import the pack and write `refs/remotes/<remote>/*`, mapping only `refs/heads/*`, with no tag following. It refuses a tracking ref that moved during the fetch instead of overwriting it.
- `httpPushOutcome` takes a `PushClientResult`.
- `httpRefspecOf` keeps the `+`: in 0.4 it is the per-ref force signal. The new `pushRefspecOf` is the same function.
- Duplex pushes are judged per ref when the transport reports statuses.
- The repository files view still hides any path holding a `..` segment, instead of letting webrun-files resolve it or throw.
