---
"@statewalker/workspace.core": patch
---

`ProjectBuilder`: a run that was stopped (abort, `maxTasks`) no longer makes the next run redo every task of the builders that had work left: their queued tasks simply resume. New `reopen()` drops the open store and engine so the next access reloads the store — for hosts whose writers take turns on one project (tabs, a CLI) under a lease.
