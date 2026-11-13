---
"@statewalker/workspace.core": minor
"@statewalker/webapp.core": minor
---

Move to `@statewalker/webrun-builder` 0.3.1 (one incremental engine; builders over collections). Breaking:

- `RegisteredBuilder` is now a `BuilderDef` whose `run(ctx, project)` / `dispose(key, outputs, project)` receive the project (optional `version`: bump it to re-run the builder's tasks). Generator handlers (`BuilderHandler`), `readUpdates`, `yieldControl`, `configureYield`, `SCAN_CELL`, `SOURCES_SIGNAL` (now `SOURCES_COLLECTION`) and `SOURCES_REMOVED_SIGNAL` are gone: a removed file retracts its rows and calls `dispose`.
- `ProjectBuilder` no longer extends the engine. `run(opts)` returns a promise of the run's stats (`executed`, `skipped`, `failed`, `deadLettered`, `pending`, `scanned`, `failures`) instead of a progress generator (use `onProgress`), and rejects when tasks of registered builders keep failing (`failOnError: false` resolves with them; `retryFailed: false` leaves them until their input changes).
- `status()` is `{ queued, deadLetters }` (was `{ nextTransactionId, builders }`); `registeredBuilders()` lists the builder ids.
- `restartFrom(id)` re-runs that builder's tasks; downstream builders re-run only where its outputs change (previously everything downstream was replayed) — restart a downstream builder whose code changed by its own id.
- State persists under `.project/state/build` (`configurePersistence` to change it), so the first run after the upgrade re-processes everything; the old `.project/state/*.json` files are no longer used.
- `webapp.core`: `APP_DEPS_SIGNAL` / `APP_MODULES_SIGNAL` are now `APP_DEPS_COLLECTION` / `APP_MODULES_COLLECTION`; the deps/transpile builders run per source file and an edited module is re-primed eagerly (a failure rejects `build()`). `webrun-dataflow` is no longer a dependency.

New: `configureScanBatch(n)` runs a large project through the pipeline in batches of `n` changed files; `configureEngine({ concurrency, batchSize, maxAttempts })` tunes the engine. A builder registered after the project was scanned (or in a later session) covers every existing file. CI now publishes every merge to `main`.
