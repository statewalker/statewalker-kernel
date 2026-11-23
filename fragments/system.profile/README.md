# system.profile

## What it is

The core fragment that keeps the user's profile on this device: JSON values under string keys, in Web Storage (`localStorage`) or in memory. system.workbench keeps its layouts per device mode there, system.settings each fragment's settings values (under `settings/<fragment-id>`), and the store is a `KernelProfile`, so the kernel can keep its fragment records in it too. It declares no extension points yet: the `secrets` point and the vault come later (statewalker-root#264, #265). It is a private workspace package, `@statewalker/system.profile`, with no React, no DOM and no Node built-ins.

## Why it exists

ADR `2026-11-20-kernel-and-core-fragments` (statewalker-root) gives `system.profile` the user's state: settings values, saved layouts, the route table and the vault, local to the device (spec statewalker-root#215, user story 30). The first thing kept there is the workbench's layout per device mode (user story 6), so this is the smallest store that serves it, with the shape the vault will sit behind.

## How to use

```ts
import {
  createMemoryStorage,
  createStorageProfile,
  createSystemProfile,
  SYSTEM_PROFILE_ID,
  systemProfileArchive,
} from "@statewalker/system.profile";
```

| Export | Provides |
| --- | --- |
| `systemProfileArchive`, `SYSTEM_PROFILE_ID` | The fragment's files (`fragment.jsonc`, `fragment.client.jsonc`), for `createKernel({ core })`. |
| `createSystemProfile({ storage?, prefix? })` → `{ store, activate }` | The fragment's code: its store over `storage` (memory by default), every key under `prefix`, and the body of its client activator. |
| `ProfileStore` | `get(key)` (a copy; `undefined` when absent or not JSON), `set(key, value)` (throws a `TypeError` for a value JSON cannot hold, and whatever the storage throws), `delete(key)`, `keys(prefix?)`. A `KernelProfile`. |
| `createStorageProfile(storage, prefix?)` | A `ProfileStore` over any `StorageLike`. |
| `createMemoryStorage()`, `StorageLike` | A Web Storage in memory; the part of Web Storage the store uses. |

## Examples

In a browser shell, the profile in `localStorage` under the application's id, given to the workbench:

```ts
const profile = createSystemProfile({ storage: localStorage, prefix: "org.example.app:" });
const workbench = createSystemWorkbench({ commands: bus, profile: profile.store });
const kernel = createKernel({
  platform,
  core: [systemProfileArchive, systemCommandsArchive, systemWorkbenchArchive],
  activators: {
    client: (fragment, context) =>
      fragment.id === SYSTEM_PROFILE_ID ? profile.activate(context) : /* the others */ undefined,
  },
});
```

The keys are plain strings; `localStorage` then holds `org.example.app:workbench/layouts/desktop` with the desktop layout as JSON.

## Internals

Each value is stored as JSON text under `<prefix><key>`, so one storage holds several applications' profiles and `keys()` lists only this one's. Reads parse a copy, so changing a value read changes nothing stored; text that is not JSON reads as absent. Writes are synchronous: Web Storage is, and the workbench saves a layout as it changes. The profile is local to the device; syncing it between devices is not designed yet.

### Dependencies

- `@statewalker/kernel.core`: the `KernelProfile` and activation context types, the archive type.

## License

MIT. See [LICENSE](../../LICENSE).
