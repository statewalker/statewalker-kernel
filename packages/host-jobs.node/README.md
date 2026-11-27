# @statewalker/host-jobs.node

## What it is

The processor behind the `host-jobs` binding that a CellB Node host offers its fragments (statewalker-root#411). A fragment that requires the binding ships scripts in its archive and declares commands that run them, exposed as `task`. Each task of such a command becomes one OS process, and its job runs like this:

- **Input:** the task's payload arrives as JSON in `JOB_PARAMS`.
- **Log:** each stdout and stderr line is a job-log entry.
- **End:** the job ends `done` (exit 0) or `error`.
- **Cancel:** sends SIGTERM to the process group, then SIGKILL after a grace period, and the job ends `cancelled`.
- **Restart:** after a host restart, processes left from before are killed and their tasks end `cancelled`.

It replaces statewalker-sandbox's JobManager (`apps/jobs-manager`). It keeps JobManager's process groups, grace period, line-by-line output and orphan clean-up. JobManager's REST, SSE, MCP and CLI surfaces are not carried over: commands and their exposures replace them. The package is private and Node only.

## Why it exists

ADR `2026-11-23-commands-tasks-and-jobs` (statewalker-root), decision 6, turns JobManager into a Node-host processor. Long-running work is often easiest to write as a script. With this processor, such work runs as an ordinary task of system.tasks' queue: a command published and followed like any other, its log read through `system.tasks/job`.

Only scripts shipped inside an installed fragment run (ADR `2026-11-19-code-kinds-and-trust`). A script path that leaves the fragment's archive is refused. User and agent scripts never reach this processor: they go through the sandbox broker.

## How to use

A fragment requires the binding, and each of its commands names its script (`x-host-job`, relative to the archive's root):

```jsonc
// fragment.jsonc
{ "id": "org.example.jobs", "bindings": ["host-jobs"], "aspects": { "client": {} } }
// fragment.client.jsonc
{ "extensions": [{ "point": "commands", "data": {
  "operation": { "operationId": "count", "x-idempotent": true,
                 "x-host-job": { "script": "scripts/count.sh" },
                 "responses": { "200": { "description": "exit", "content": { "application/json": { "schema": { "type": "object" } } } } } },
  "exposures": { "task": {} } } }] }
```

The host runs the processor over its own system.tasks queue:

```ts
import { createHostJobs } from "@statewalker/host-jobs.node";

const jobs = createHostJobs({
  store, // the host's system.tasks queue (its fragment DO's)
  commands: () => [{ command: "org.example.jobs/count", root: "/srv/archives/org.example.jobs", script: "scripts/count.sh" }],
  stateDir: "/srv/data/host-jobs", // the running processes' records, for a restart
});
await jobs.start(); // ends what a previous run left, then serves the commands
// publish `fragments.org.example.jobs.count` with { n: 3 }: the job log gets each line, then `done`
await jobs.stop();
```

apps/notes' `node` launch configuration does exactly this (`scripts/launch.mjs`). It reads the commands from the built archives of the fragments that require `host-jobs`, and offers the binding to the kernel (`launch.json`'s `bindings`). The `browser` configuration does not offer it, so the kernel refuses such a fragment's install: `needs the binding "host-jobs", which this host lacks`.

| Export | Provides |
| --- | --- |
| `createHostJobs(options)` → `{ start, sync, stop }` | The processor. Options: `store`, `commands()`, `stateDir`, and optionally `graceMs` (5 s), `heartbeatMs` (1 s), `leaseMs`, `waitMs`, `env`, `onError`. |
| `HOST_JOBS_BINDING`, `HOST_JOBS_PRINCIPAL` | `host-jobs`, and the principal the subscriptions and leases are held as (system.tasks' own, `system:tasks`, so its `jobs`/`job` read these jobs and a fragment's removal removes their subscriptions). |
| `resolveScript(root, script)`, `ScriptRefusedError` | A script's real path inside the archive. It refuses absolute paths, `..`, links leading out, and anything that is not a file. |
| `hostJobScriptOf(operation)` | The `x-host-job` script of a command's operation. |

## Internals

- **One subscription per command,** `<fragment-id>.<command-id>` on `fragments.<fragment-id>.<command-id>`, the subject the `task` exposure uses. system.tasks' runner in the page leaves `x-host-job` commands alone.
- **The process:**
  - The interpreter comes from the script's extension: `.sh` runs with bash, `.py` with python3, `.js`/`.mjs` with node; a script with another extension is executed itself.
  - The process runs in its own group (`detached`), with the archive's root as its working directory.
  - Its environment is the host's, plus `JOB_ID` (the job), `JOB_TASK` and `JOB_PARAMS`.
- **The log:** each line is `{ stream: "stdout" | "stderr", line }`. The queue records the job's last entry (`done`, `error` or `cancelled`). The reply is `{ exitCode: 0 }`, or the error with the last 20 lines of stderr. The job is also recorded in system.tasks' job index, so `system.tasks/jobs` finds it.
- **Cancel:**
  - The queue's cancel reaches a running job at its next lease renew. A heartbeat renews every `heartbeatMs` while the script prints nothing.
  - On a cancel, SIGTERM goes to the group, and SIGKILL follows `graceMs` later, even after the script itself has exited, since its children may ignore SIGTERM.
  - What the script prints after the cancel is not logged: the queue takes no entries of a cancelled task.
- **Restart:**
  - Each running process is recorded in `stateDir/<job>.json` (its pid and task) and the record is removed when the process ends.
  - `start()` kills each recorded group still there, then cancels its task, so the job ends `cancelled` and is not run again.
- **Retries:** the queue retries a failed job up to the subscription's attempts. A refused script is refused at every attempt, and its reply says no retry follows.

## License

MIT. See [LICENSE](../../LICENSE).
