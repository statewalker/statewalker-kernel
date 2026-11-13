---
"@statewalker/workspace.core": minor
---

`ProjectBuilder.steps(opts)`: `run()` as an async generator — yields each scan (`kind: "scan"`) and each committed engine batch (`kind: "batch"`), returns the run's result. The build waits at every `yield`, so a host can pause between batches or stop with `break`; the next run continues from the queue. A run stopped this way (or by a throw) still records what it changed, so builders absent from it catch up later. Needs `@statewalker/webrun-builder` ^0.4.0 (`BuildEngine.steps()`).
