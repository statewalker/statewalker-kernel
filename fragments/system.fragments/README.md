# system.fragments

## What it is

The core fragment that manages the app's fragments while the app runs. Its model, the fragment manager, does four things:

- it reads an archive before the user consents and says what the archive asks for: the consent summary;
- it installs the archive with the requirements it proposes from the app's catalog, all or nothing;
- it lists the installed fragments with their states;
- it enables, disables, retries and removes them.

The kernel does the work; the manager says what will happen and why the kernel would refuse. It is a private workspace package, `@statewalker/system.fragments`, written without React. Its client half (the consent dialog and the manager view) comes in a later slice of statewalker/statewalker-root#261.

## Why it exists

The spec statewalker/statewalker-root#215, through the ticket statewalker/statewalker-root#261, asks for fragments to be installed live once the user has agreed. The user must see the archive's identity and content hash, its platform range, bindings, requirements, server half, agent plugins, secrets and the command exposures beyond the bus, and must see every reason it would be refused before anything is installed. The ticket also asks for fragments to be disabled, re-enabled, retried after a failure, and removed with or without their data.

## How to use

```ts
import { createFragmentManager, systemFragmentsArchive } from "@statewalker/system.fragments";

const manager = createFragmentManager({ kernel, platform, catalog });
const summary = await manager.inspect(files, { source: "notes-export.zip" });
if (summary.installable) await manager.install(summary); // after the user agreed to `summary`
manager.list(); // [{ id, version, state: "active", failures: [], dependents: [] }, ...]
```

| Export | Provides |
| --- | --- |
| `systemFragmentsArchive`, `SYSTEM_FRAGMENTS_ID` | The fragment's files, for `createKernel({ core })`. |
| `createFragmentManager({ kernel, platform, catalog? })` | The manager. `catalog.load(id)` gives an archive the app offers, which becomes a proposed requirement. |
| `FragmentManager.inspect(files, { source })` → `ConsentSummary` | The archive's identity, `archive` hash, `platform { range, fits }`, `bindings` (offered or not), `requires`, `server`, `agentPlugins`, `secrets`, `exposures`, `refusals` and `installable`. Each entry of `requires` is installed, proposed from the catalog (followed recursively) or missing. |
| `FragmentManager.install(summary)` | Installs the proposed requirements and the archive, then enables them, requirements first. On a refusal it rejects with the kernel's `FragmentInstallError` and leaves nothing installed. |
| `FragmentManager.list()` → `FragmentEntry[]` | The app's fragments (no core fragment), each with its `state`, its `failures` (aspect and error message) and its enabled `dependents`. `state` is one of `active`, `failed`, `unresolved`, `disabled` or `installed`. |
| `enable(id)`, `disable(id, { cascade? })`, `retry(id)`, `remove(id, { withData? })` | The kernel's operations. A cascading disable leaves dependents enabled but unresolved. Core fragments are refused. |

## Examples

An archive that needs a binding the platform does not offer cannot be installed, and the summary says why:

```ts
const summary = await manager.inspect(files, { source: "upload" });
summary.installable; // false
summary.refusals; // [{ code: "missing-binding", ... }]
```

## Related

- `@statewalker/kernel.core`: `install`, `enable`, `disable`, `retry`, `remove`, `dependentsOf` and the refusal codes.
- `@statewalker/cellb`: from 0.15.0, the fragment hosts' `remove(id, { withData: true })` deletes a server half's data.
