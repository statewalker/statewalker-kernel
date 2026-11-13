---
"@statewalker/workspace.core": minor
"@statewalker/webapp.core": minor
---

Move to `@statewalker/webrun-builder` 0.3.1 (one incremental engine; builders over collections). `RegisteredBuilder` is now a `BuilderDef` whose `run(ctx, project)` / `dispose(key, outputs, project)` receive the project — no more generator handlers, `readUpdates`, `yieldControl` or `sources-removed` signal (a removed file retracts its rows and calls `dispose`). `ProjectBuilder.run()` returns a promise of the run's stats (scan + engine) and rejects when tasks keep failing; state persists under `.project/state/build` (`configurePersistence` to change it); `registeredBuilders()` lists the builder ids. `webrun-dataflow` is no longer a dependency. `webapp.core`'s deps/transpile builders run per source file (`app-deps`, `app-modules` collections).

`ProjectBuilder.run(opts)` takes `ProjectBuildOptions` (`retryFailed`, `failOnError`, plus the engine's `maxTasks`, `signal`, `onProgress`) and resolves with `failures`; `configureScanBatch(n)` runs a large project through the pipeline in batches of `n` changed files; `configureEngine({ concurrency, batchSize, maxAttempts })` tunes the engine. CI now publishes every merge to `main`.
