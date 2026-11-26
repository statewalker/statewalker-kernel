# system.tasks

## What it is

The core fragment that holds the host's durable task queue (`@statewalker/shared-tasks`) and serves the `task` exposure: every command a fragment exposes as `task` runs from the queue. It also offers three commands of its own on system.commands' bus, `system.tasks/publish`, `system.tasks/cancel` and `system.tasks/job`. It is a private workspace package, `@statewalker/system.tasks`, with no React and no DOM. Headless, the queue lives in any `SqlLike` store (SQLite in memory in the tests). With server halves, it lives in the fragment's own DO, in the DO's SQL storage (statewalker-root#409):
- the server half is `server/index.js` with `wrangler.jsonc`, the Worker `system-tasks`, and answers `POST /queue` with one store operation;
- the client half reaches it through `remoteQueueStore`;
- tasks and job logs outlive the page and the host's restarts.

The runners that serve task-exposed commands stay in the client half, where the handlers are. A lease outlives a closed page only until it expires, and then the task runs again.

## Why it exists

ADR `2026-11-23-commands-tasks-and-jobs` (statewalker-root) keeps commands and tasks as two models with one execution context:
- a command call is synchronous for its caller and may carry live objects;
- a task is a durable message, delivered at least once, whose sender does not wait.

A command joins the queue only when it opts in to the `task` exposure. system.tasks then serves its subscription by calling the command's handler, with the task's id as `callId`, the lease's cancellation as `signal`, and progress written to the job log. It is the twelfth core fragment, and it cannot be disabled: commands that opt in depend on it.

## How to use

```ts
import { createSystemCommands, systemCommandsArchive } from "@statewalker/system.commands";
import {
  createSystemTasks,
  SYSTEM_TASKS_ID,
  systemTasksArchive,
  taskSubject,
} from "@statewalker/system.tasks";

const commands = createSystemCommands({ gate: security.gate });
let tasks;
const kernel = createKernel({
  platform,
  core: [systemCommandsArchive, systemTasksArchive /* , ... */],
  resolvers: {
    // A core fragment's references name its in-process module.
    module: (ref, { contributor }) =>
      contributor.id === SYSTEM_TASKS_ID ? tasks.module[ref.export] : resolveModule(ref, contributor),
  },
  activators: {
    client: (fragment, context) =>
      fragment.id === SYSTEM_TASKS_ID ? tasks.activate(context) : activateClient(fragment, context),
  },
});
tasks = createSystemTasks({
  commands: commands.bus,
  callAs: commands.callAs, // held by the host: runs a task's command for its publisher
  slots: kernel.slots,
  sql,
  gate: security.gate,
});

// Run org.example.notes/export from the queue, and wait for its reply.
const reply = await commands.bus.call("system.tasks/publish", {
  subject: taskSubject("org.example.notes/export"),
  payload: { all: true },
});
// { task, job, result } — or { task, job, error } after the last attempt, or { task, job, cancelled: true }
```

A fragment exposes a command to the queue in its `fragment.client.jsonc`. The operation must declare `"x-idempotent": true` and a JSON object output:

```jsonc
{
  "point": "commands",
  "data": {
    "operation": {
      "operationId": "export",
      "x-idempotent": true,
      "requestBody": { "content": { "application/json": { "schema": { "type": "object" } } } },
      "responses": { "200": { "content": { "application/json": { "schema": { "type": "object" } } } } }
    },
    "exposures": { "task": {} }
  },
  "reference": { "module": "./commands.js", "export": "exportNotes" }
}
```

## Reference

| Export | What it is |
| --- | --- |
| `createSystemTasks(options)` | The fragment's code: `queue` (when it is in this process), `store`, `module` (its commands' handlers) and `activate(context)`. |
| `SystemTasksOptions` | `commands` (the bus), `callAs` (system.commands', held by the host), `slots` (the kernel's), `store` or `sql` (where the queue is), `gate`, and optionally `queue` (clock, ids, limits), `leaseMs`, `maxAttempts`, `waitMs`, `onError`. |
| `taskSubject(id)`, `subscriptionName(id)` | `fragments.<fragment-id>.<command-id>` and `<fragment-id>.<command-id>` for a command `<fragment-id>/<command-id>` (a subscription's name takes no `/`). |
| `TASKS_PROJECT`, `TASKS_PRINCIPAL` | The queue's one project (`local`) and the principal system.tasks holds leases as (`system:tasks`). |
| `SYSTEM_TASKS_ID`, `systemTasksArchive` | The fragment's id and its archive for `createKernel({ core })`, with its server half's `wrangler.jsonc`. |
| `QueueStore`, `localQueueStore(queue, sql?)`, `sqlQueueStore(sql)` | Every queue operation system.tasks makes, asynchronous. The local stores keep the queue in this process; `sqlQueueStore` also keeps the job index in `sql`. |
| `remoteQueueStore(send)`, `serveQueueStore(store)`, `QueueOperation` | The queue in the fragment's DO. The client half sends each operation as JSON, and the DO runs only the store's named operations. A reader crosses without its functions, and an absent argument keeps its position as `null`. |
| `queueErrorToData`, `queueErrorFromData` | A refusal as it crosses, `{ error, code }`. The `code` is kept because the runner recognises a cancellation by it (`ECANCELED`). |
| `TaskJob` | One job of a task: `{ job, at, reply? }`. |

**Commands**

| Command | Does |
| --- | --- |
| `system.tasks/publish` `{ subject, payload?, wait? }` | Publishes a task. By default it waits for the reply: `{ task, job, result }`, or `error`, or `cancelled`; a waited publish that no subscription serves is refused at once. With `wait: false` it returns `{ task }` at once. Aborting the call cancels the task. Offered to agents as a `write` tool. |
| `system.tasks/cancel` `{ task }` | Cancels a task. A waiting one is removed. A running one stops at once on this host (its runner renews, the queue answers "cancelled", the handler's `signal` aborts), with no retry and no dead letter. |
| `system.tasks/jobs` `{ task }` | The jobs that ran a task, oldest first, each with its reply once it has ended (`{ job, result }`, `{ job, error }` or `{ job, cancelled: true }`). A viewer that knows only the task, for example after a reload, finds its log and its answer this way. |
| `system.tasks/job` `{ job, after?, wait_ms? }` | Reads a job log: its entries after the stamp `after`, waiting up to `wait_ms` (at most 60 s) for one. The last entry of an ended job records `done`, `error` or `cancelled`. |

**Behaviour**

- **One subscription per `task`-exposed command**, `<fragment-id>.<command-id>` on `fragments.<fragment-id>.<command-id>`, created when the command reaches the bus. A runner serves it while the command is on the bus.
- **A disabled fragment's commands leave the bus,** and their runners stop. The subscriptions stay, so tasks wait for the fragment's return and are served then. Removing the fragment removes its subscriptions, and its waiting tasks' publishers get an error reply.
- **Retries and dead letters** are the queue's. A handler that throws is retried up to the subscription's attempts (3 by default); the last failure replies with the error and goes to the dead letters.
- **Rights.**
  - Each task carries its publisher: `user` for the user and system code, `capability:<c>` for a caller that went through system.commands' gate.
  - A task a gated caller published runs only if the gate lets that caller run the target command when the task runs, as a direct call would be decided. It then runs as that caller (`callAs`), so its handler sees the capability, not the user. A refusal is final: the publisher gets the error, and the task is not tried again. Without a gate it is refused.
  - The user cancels any task and reads any job log. A gated caller cancels only its own tasks and reads only their job logs.

## Related

- `@statewalker/shared-tasks`: the queue, its contract and the runner.
- `@statewalker/system.commands`: the bus, the `task` exposure in `commandSchema`, and the call context (`caller`, `callId`, `signal`, `progress`).
- `@statewalker/kernel.core`: activation, the installed-fragments slot, `DISABLEABLE_CORE`.
