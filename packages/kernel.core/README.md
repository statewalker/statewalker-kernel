# @statewalker/kernel.core

## What it is

The platform's kernel: it reads a fragment's `fragment.jsonc`, refuses what cannot run on this host, and takes fragments through their lifecycle (installed, enabled, resolved, active per aspect). The lifecycle state is membership in keyed slots of `@statewalker/shared-slots`, so the fragment manager, the extension registry and the workbench observe it like any other slot. No React, no DOM, no Node built-ins.

## Why it exists

The platform (statewalker/statewalker-root#215) loads fragments while it runs, on every host. Before this package, fragments were code registered at activation (`backbone.core`, sandclaw's `kernel.core`): nothing could be checked before the code ran, and the state of a fragment was a private record. Here a fragment is first data, a manifest validated against a versioned JSON Schema, and its state is public: anyone holding the slot bus sees which fragments are installed, enabled, resolved and active.

## How to use

```sh
pnpm add @statewalker/kernel.core
```

| Import | Provides |
| --- | --- |
| `createKernel`, `Kernel`, `KernelOptions`, `PlatformInfo`, `AspectActivator` | The kernel: `start`, `install`, `enable`, `disable`, `activate`, `deactivate`, `stop`. |
| `installedFragmentsSlot`, `enabledFragmentsSlot`, `resolvedFragmentsSlot`, `activeFragmentsSlot(aspect)` | The keyed slots `system:fragments:installed`, `:enabled`, `:resolved`, `:active:<aspect>`. |
| `FragmentInstallError`, `Refusal`, `RefusalCode`, `FragmentLifecycleError` | Why an install or a lifecycle step was refused. |
| `fragmentManifestSchemaV1`, `FragmentManifest`, `ASPECTS`, `MANIFEST_FILE`, `parseJsonc` | The manifest, its schema and its parser. |
| `isFragmentId`, `isSystemId`, `workerNameOf`, `SYSTEM_PREFIX` | Fragment ids and the server half's Worker name. |
| `@statewalker/kernel.core/schemas/fragment.v1.schema.json` | The schema file, for `$schema`. |

## Examples

A `fragment.jsonc`:

```jsonc
{
  "$schema": "./node_modules/@statewalker/kernel.core/schemas/fragment.v1.schema.json",
  "id": "org.statewalker.fragment-notes",
  "version": "1.0.0",
  "engines": { "platform": "^1.0.0" },
  "requires": { "org.statewalker.fragment-files": "^2.1.0" },
  "bindings": ["durable-objects"],
  "aspects": { "server": {}, "client": { "dir": "web" } }
}
```

Install it, enable it, activate its client half:

```ts
import { activeFragmentsSlot, createKernel, FragmentInstallError } from "@statewalker/kernel.core";

const kernel = createKernel({
  platform: { version: "1.0.0", bindings: ["durable-objects"] },
  core: [systemCommandsArchive], // shipped with the platform: may use system.*
  activators: { client: async (fragment) => (await import(urlOf(fragment))).activate() },
});
await kernel.start(); // installs and enables the core fragments

try {
  // An archive's root files as text: fragment.jsonc, wrangler.jsonc, ...
  await kernel.install([notesArchive, filesArchive]); // all or nothing
} catch (error) {
  if (error instanceof FragmentInstallError) console.log(error.refusals); // [{ id, code, message }]
}
await kernel.enable("org.statewalker.fragment-files");
await kernel.enable("org.statewalker.fragment-notes");
await kernel.activate("client", "org.statewalker.fragment-notes"); // files first, then notes

kernel.slots.observe(activeFragmentsSlot("client"), (active) => console.log([...active.keys()]));
```

## Internals

### The manifest

`fragment.jsonc` is JSONC (comments and trailing commas). Its `$schema` names the schema by file name: a value ending in `fragment.v1.schema.json` is version 1, wherever the file is served from, so the URL stays neutral and each distribution hosts it where it likes. The schema is JSON Schema 2020-12, with no namespace key; it fixes the aspects (`server`, `client`, `agent`, each with an optional `dir`) and refuses unknown keys. The kernel then checks what the schema cannot: `version` is semver, `engines.platform` and every `requires` value are semver ranges.

### Refusals

An install is a list of archives, accepted or refused as a whole. A `FragmentInstallError` carries every refusal, each with a code:

- `invalid-manifest`: no `fragment.jsonc`, JSONC that does not parse, an unknown `$schema` version, a schema violation, a bad version or range;
- `invalid-id`: not reverse-domain (two or more segments of `a-z`, `0-9` and inner `-`, each starting with a letter);
- `reserved-id`: a `system.*` id from a fragment not passed as `core`;
- `worker-name`: a server aspect whose `wrangler.jsonc` is missing, names its Worker other than `workerNameOf(id)` (the id with dots turned into hyphens), takes a name another fragment has, or would be longer than 63 characters;
- `incompatible-platform`, `missing-binding`: `engines.platform` or `bindings` that this host does not meet;
- `unmet-requirement`: a required fragment neither installed nor in the same install, or in a version outside the range;
- `already-installed`: one version per fragment per host.

### Lifecycle as slot membership

Each state is a keyed slot, and a fragment is in every slot whose state it has reached: an active fragment is also installed, enabled and resolved. Every slot holds the same frozen `InstalledFragment`, so a state change is one register or dispose and nothing briefly disappears.

- **Resolved**: enabled, and every required fragment resolved in a version inside its range. A cycle never resolves.
- **Active**: per aspect. `activate(aspect, id?)` runs the host's activator for the aspect, requirements first (a stable topological sort carried over from sandclaw's `kernel.core`); the fragment joins the slot once the activator has finished. A fragment whose activator throws stays inactive and is reported to `onError`; the fragments requiring it are not activated, every other fragment is (carried over from `backbone.core`).
- **Deactivation** runs in reverse activation order: `deactivate(aspect, id)` first deactivates the fragments requiring `id`, `stop()` deactivates everything. Cleanups that throw are reported and the rest goes on.
- **Disable** refuses when resolved fragments require the fragment, unless `{ cascade: true }` confirms it; they are then deactivated first and become unresolved, staying enabled.

Operations run one after another, in the order they were called.

### Dependencies

- `@statewalker/shared-slots`: the slot bus.
- `@cfworker/json-schema`: JSON Schema 2020-12 validation without code generation, so it runs under a strict CSP and in Workers.
- `jsonc-parser`: VS Code's JSONC parser.
- `semver`: npm's semver.

## License

MIT. See [LICENSE](../../LICENSE).
