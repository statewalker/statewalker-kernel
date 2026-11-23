# @statewalker/kernel.core

## What it is

The platform's kernel: it reads a fragment's `fragment.jsonc`, refuses what cannot run on this host, takes fragments through their lifecycle (installed, enabled, resolved, active per aspect), and routes extensions to the owners of extension points. The lifecycle state is membership in keyed slots of `@statewalker/shared-slots`, so the fragment manager and the workbench observe it like any other slot. No React, no DOM, no Node built-ins.

## Why it exists

The platform (statewalker/statewalker-root#215) loads fragments while it runs, on every host. Before this package, fragments were code registered at activation (`backbone.core`, sandclaw's `kernel.core`): nothing could be checked before the code ran, and the state of a fragment was a private record. Here a fragment is first data, a manifest validated against a versioned JSON Schema, and its state is public: anyone holding the slot bus sees which fragments are installed, enabled, resolved and active.

## How to use

```sh
pnpm add @statewalker/kernel.core
```

| Import | Provides |
| --- | --- |
| `createKernel`, `Kernel`, `KernelOptions`, `PlatformInfo`, `AspectActivator`, `ActivationContext` | The kernel: `start`, `install`, `enable`, `disable`, `activate`, `deactivate`, `stop`. |
| `OwnedExtensionPoints`, `Extension`, `ExtensionChange`, `ExtensionListener`, `extensionPointId` | What a point's owner reads: its points, their extensions, the changes. |
| `LazyReference`, `ReferenceResolvers`, `ReferenceResolver`, `ReferenceContext`, `referenceKind`, `ExtensionUnavailable` | Lazy references to a contributor's code, the host's resolvers, and the error once the contributor is gone. |
| `extensionContributionsSlot(aspect)`, `ExtensionContribution`, `extensionRefusalsSlot(aspect)`, `ExtensionRefusal` | Runtime extensions (`system:extensions:contributed:<aspect>`) and refused extensions with their reasons (`system:extensions:refused:<aspect>`). |
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

An owner opens an extension point, another fragment extends it. In the owner's `fragment.jsonc`:

```jsonc
"aspects": {
  "client": {
    "extensionPoints": {
      "exporters": {
        "description": "Ways to export a note",
        "schema": { "type": "object", "required": ["label"], "properties": { "label": { "type": "string" } } }
      }
    }
  }
}
```

In the contributor's, with no `requires` on the owner:

```jsonc
"aspects": {
  "client": {
    "extensions": [
      {
        "point": "org.statewalker.fragment-notes/exporters",
        "data": { "label": "Markdown" },
        "reference": { "module": "./export-markdown.js", "export": "exportMarkdown" }
      }
    ]
  }
}
```

The owner reads its points from its activation context; the host resolves references:

```ts
const kernel = createKernel({
  platform,
  resolvers: {
    module: (ref, { contributor }) => importExport(contributor, ref.module, ref.export ?? "default"),
    entrypoint: (ref, { contributor }) => bindService(contributor, ref.entrypoint, ref.method),
    command: (ref) => (input: unknown) => commands.call(ref.command, input),
  },
  activators: {
    client: (fragment, { extensions }) => {
      if (fragment.id !== "org.statewalker.fragment-notes") return;
      return extensions.observe("exporters", (all, { added, removed }) => {
        menu.set(all.map((e) => ({ label: (e.data as { label: string }).label, run: () => e.reference?.call(note) })));
      });
    },
  },
});
```

Code adds runtime extensions through a slot, keyed under its fragment's id:

```ts
const withdraw = kernel.slots.register(extensionContributionsSlot("client"), "org.example.fragment-pdf/pdf", {
  contributor: "org.example.fragment-pdf",
  point: "org.statewalker.fragment-notes/exporters",
  data: { label: "PDF" },
  reference: { command: "org.example.fragment-pdf/export" },
});
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
- **Active**: per aspect. `activate(aspect, id?)` runs the host's activator for the aspect, requirements first (a stable topological sort carried over from sandclaw's `kernel.core`); the fragment joins the slot once the activator has finished. A fragment whose activator throws stays inactive and is reported to `onError`; the fragments requiring it, directly or through fragments that lack the aspect, are not activated, every other fragment is (carried over from `backbone.core`).
- **Deactivation** runs in reverse activation order: `deactivate(aspect, id)` first deactivates the fragments requiring `id` (again also through fragments that lack the aspect), `stop()` deactivates everything. Cleanups that throw are reported and the rest goes on.
- **Disable** refuses when resolved fragments require the fragment, unless `{ cascade: true }` confirms it; they are then deactivated first and become unresolved, staying enabled.

Operations run one after another, in the order they were called. An operation called while an activator or a cleanup runs is rejected at once with a `FragmentLifecycleError`: an activator that awaited the kernel would otherwise wait for its own operation forever. This also refuses a call from elsewhere that lands while a hook runs; call again once the running operation has settled.

### Extensions

A fragment opens **extension points** in one aspect, under `aspects.<aspect>.extensionPoints` of `fragment.jsonc`: a name (`a-z`, `0-9`, inner `-`) and a JSON Schema (2020-12). A point's id is `<fragment-id>/<name>`; a core fragment's point is known by its short name alone (`menus`), and two core fragments cannot open the same one (`extension-point-conflict`). A name is opened in one aspect only, since the id carries no aspect.

A fragment contributes **extensions** to points of the same aspect, under `aspects.<aspect>.extensions`, or at runtime by registering an `ExtensionContribution` in `extensionContributionsSlot(aspect)` under the key `<contributor>/<name>`. An extension is `data` plus an optional `reference`: a client module export (`{ module, export? }`), a server entrypoint method reached through a service binding (`{ entrypoint, method }`), or a command (`{ command }`). Contributing needs no `requires`.

The registry is computed from public state: an extension is **live** while its contributor and the point's owner are resolved (and, for a runtime one, while it stays registered). An extension whose point is not open is **dormant**: nothing is reported, and it is checked once the owner resolves. A live extension's data must match the point's schema; one that does not, one in the wrong aspect and a malformed runtime contribution are **refused**, published in `extensionRefusalsSlot(aspect)` with a code and a message while the contributor and point are there. Extensions read in a stable order: static ones in resolution order, then runtime ones in registration order.

The owner gets its points from the context its activator receives (`context.extensions`), only for the aspect being activated, and nobody else gets them. `read(name)` is synchronous and `observe(name, listener)` calls the listener at once, then with `added` and `removed` on every change; both work while the activator runs, when every kernel operation is refused, because they read state and change nothing. A listener that throws is reported to `onError`. When the aspect is deactivated (or its activator throws) the handle closes: reads are empty and listeners stop.

A **reference** is handed only to the owner, as `extension.reference`. The kernel loads no code: `resolve()` goes through the host's resolver for the kind (`KernelOptions.resolvers`), and `call(...args)` resolves a function and calls it. A reference is usable while its extension is live and the owner's handle is open. Otherwise `ExtensionUnavailable` is raised: on `resolve` and `call`, on a function resolved earlier, for a kind the host does not resolve, and for a resolution or a call still pending when the extension goes, so nothing waits on a fragment that has left.

### Dependencies

- `@statewalker/shared-slots`: the slot bus.
- `@cfworker/json-schema`: JSON Schema 2020-12 validation without code generation, so it runs under a strict CSP and in Workers.
- `jsonc-parser`: VS Code's JSONC parser.
- `semver`: npm's semver.

## License

MIT. See [LICENSE](../../LICENSE).
