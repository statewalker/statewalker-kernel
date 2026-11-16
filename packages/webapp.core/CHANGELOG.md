# @statewalker/webapp.core

## 0.8.0

### Minor Changes

- 29f68ab: **Move to `@statewalker/webrun-files` 0.12, with the webrun-sites and webrun-vcs releases built on it.** The dependency ranges move:
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

### Patch Changes

- Updated dependencies [29f68ab]
  - @statewalker/workspace.core@0.8.0

## 0.7.0

### Minor Changes

- Release of the changes since the last published version:
  
  - @statewalker/workspace.core crosses a breaking line

### Patch Changes

- Updated dependencies [843fc1b]
  - @statewalker/workspace.core@0.7.0

## 0.6.0

### Minor Changes

- c3599dc: Move to `@statewalker/webrun-builder` 0.3.1 (one incremental engine; builders over collections). Breaking:
  
  - `RegisteredBuilder` is now a `BuilderDef` whose `run(ctx, project)` / `dispose(key, outputs, project)` receive the project (optional `version`: bump it to re-run the builder's tasks). Generator handlers (`BuilderHandler`), `readUpdates`, `yieldControl`, `configureYield`, `SCAN_CELL`, `SOURCES_SIGNAL` (now `SOURCES_COLLECTION`) and `SOURCES_REMOVED_SIGNAL` are gone: a removed file retracts its rows and calls `dispose`.
  - `ProjectBuilder` no longer extends the engine. `run(opts)` returns a promise of the run's stats (`executed`, `skipped`, `failed`, `deadLettered`, `pending`, `scanned`, `failures`) instead of a progress generator (use `onProgress`), and rejects when tasks of registered builders keep failing (`failOnError: false` resolves with them; `retryFailed: false` leaves them until their input changes).
  - `status()` is `{ queued, deadLetters }` (was `{ nextTransactionId, builders }`); `registeredBuilders()` lists the builder ids.
  - `restartFrom(id)` re-runs that builder's tasks; downstream builders re-run only where its outputs change (previously everything downstream was replayed) — restart a downstream builder whose code changed by its own id.
  - State persists under `.project/state/build` (`configurePersistence` to change it), so the first run after the upgrade re-processes everything; the old `.project/state/*.json` files are no longer used.
  - `webapp.core`: `APP_DEPS_SIGNAL` / `APP_MODULES_SIGNAL` are now `APP_DEPS_COLLECTION` / `APP_MODULES_COLLECTION`; the deps/transpile builders run per source file and an edited module is re-primed eagerly (a failure rejects `build()`). `webrun-dataflow` is no longer a dependency.
  
  New: `configureScanBatch(n)` runs a large project through the pipeline in batches of `n` changed files; `configureEngine({ concurrency, batchSize, maxAttempts })` tunes the engine. A builder registered after the project was scanned (or in a later session) covers every existing file. CI now publishes every merge to `main`.

### Patch Changes

- Updated dependencies [c3599dc]
  - @statewalker/workspace.core@0.6.0

## 0.5.2

### Patch Changes

- Release of the changes since the last published version:
  
  - files changed: README.md
- Updated dependencies
  - @statewalker/workspace.core@0.5.2

## 0.1.1

### Patch Changes

- Initial public release from the statewalker multi-repo ecosystem.
- Updated dependencies
  - @statewalker/workspace.core@0.1.1
