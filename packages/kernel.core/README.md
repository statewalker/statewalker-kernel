# @statewalker/kernel.core

## What it is

The platform's kernel: it reads a fragment's `fragment.jsonc`, refuses what cannot run on this host, takes fragments through their lifecycle (installed, enabled, resolved, active or failed per aspect, removed), and routes extensions to the owners of extension points. The lifecycle state is membership in keyed slots of `@statewalker/shared-slots`, so the fragment manager and the workbench observe it like any other slot. No React, no DOM, no Node built-ins.

## Why it exists

The platform (statewalker/statewalker-root#215) loads fragments while it runs, on every host. Before this package, fragments were code registered at activation (`backbone.core`, sandclaw's `kernel.core`): nothing could be checked before the code ran, and the state of a fragment was a private record. Here a fragment is first data, a manifest validated against a versioned JSON Schema, and its state is public: anyone holding the slot bus sees which fragments are installed, enabled, resolved and active.

## How to use

```sh
pnpm add @statewalker/kernel.core
```

| Import | Provides |
| --- | --- |
| `createKernel`, `Kernel`, `KernelOptions`, `RemoveOptions`, `UpgradeOptions`, `PlatformInfo`, `AspectActivator`, `ActivationContext` | The kernel: `start`, `install`, `check` (the refusals an install would raise, installing nothing), `enable`, `disable`, `dependentsOf`, `remove`, `activate`, `retry`, `deactivate`, `upgrade`, `rollback`, `stop`. |
| `ArchiveStore`, `createMemoryArchiveStore`, `archiveHash` | The host's content-addressed store of installed archives, and the hash naming each archive. |
| `KernelProfile`, `createMemoryProfile`, `FragmentRecord`, `ArchiveRef`, `fragmentRecordKey`, `MigrationState`, `appliedMigrationsKey` | What the kernel records in the user's profile: each fragment's version, archive, enabled state and last upgrade, and the migrations of its data (applied, started, failed). |
| `ClassMigration`, `readMigrations` | The Durable Object class migrations of a server half's `wrangler.jsonc`. |
| `OwnedExtensionPoints`, `Extension`, `ExtensionChange`, `ExtensionListener`, `extensionPointId` | What a point's owner reads: its points, their extensions, the changes. |
| `LazyReference`, `ReferenceResolvers`, `ReferenceResolver`, `ReferenceContext`, `referenceKind`, `ExtensionUnavailable` | Lazy references to a contributor's code, the host's resolvers, and the error once the contributor is gone. |
| `extensionContributionsSlot(aspect)`, `ExtensionContribution`, `extensionRefusalsSlot(aspect)`, `ExtensionRefusal` | Runtime extensions (`system:extensions:contributed:<aspect>`) and refused extensions with their reasons (`system:extensions:refused:<aspect>`). |
| `installedFragmentsSlot`, `enabledFragmentsSlot`, `resolvedFragmentsSlot`, `activeFragmentsSlot(aspect)`, `failedFragmentsSlot(aspect)`, `FragmentFailure`, `waitingFragmentsSlot(aspect)`, `FragmentWaiting` | The keyed slots `system:fragments:installed`, `:enabled`, `:resolved`, `:active:<aspect>`, `:failed:<aspect>`, `:waiting:<aspect>`. |
| `FragmentInstallError`, `Refusal`, `RefusalCode`, `FragmentLifecycleError`, `FragmentCascadeError`, `FragmentRollbackError`, `FragmentDeletesClassesError`, `FragmentMigrationError`, `FragmentMigrationsPendingError` | Why an install, an upgrade or a lifecycle step was refused; a cascade refused for want of confirmation lists the dependents, an upgrade deleting classes lists them, a rollback after migrations lists those, a fragment whose data lacks migrations lists them. |
| `fragmentManifestSchemaV1`, `FragmentManifest`, `ASPECTS`, `MANIFEST_FILE`, `parseJsonc` | The manifest, its schema and its parser. |
| `fragmentAspectSchemaV1`, `AspectManifest`, `aspectFileOf` | The aspect files (`fragment.<aspect>.jsonc`) and their schema. A module reference, like an aspect's `dir`, must be a path inside the fragment (`RELATIVE_PATH`: no URL, no absolute path, no `..`), so a host never loads an archive's code from elsewhere. |
| `isFragmentId`, `isSystemId`, `workerNameOf`, `SYSTEM_PREFIX` | Fragment ids and the server half's Worker name. |
| `@statewalker/kernel.core/schemas/fragment.v1.schema.json`, `.../fragment-aspect.v1.schema.json` | The schema files, for `$schema`. |

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

Disable or remove a fragment others require: list the dependents, then confirm the cascade.

```ts
const dependents = kernel.dependentsOf("org.statewalker.fragment-files"); // ["org.statewalker.fragment-notes"]
if (await confirmCascade(dependents)) {
  await kernel.disable("org.statewalker.fragment-files", { cascade: true });
}
```

A failed aspect is published with its error, and retried once fixed:

```ts
kernel.slots.observe(failedFragmentsSlot("client"), (failed) => {
  for (const { fragment, error } of failed.values()) showFailure(fragment.id, error);
});
await kernel.retry("client", "org.statewalker.fragment-notes");
```

Removal keeps the fragment's data unless "remove with data" was confirmed; the host deletes it:

```ts
const kernel = createKernel({
  platform,
  removeData: async (fragment) => {
    await deleteDurableObjectData(fragment.id);
    await profile.deleteEntriesOf(fragment.id); // settings values, secrets
  },
});
await kernel.remove("org.example.fragment-pdf"); // data kept: a reinstall finds it
await kernel.remove("org.example.fragment-pdf", { withData: true }); // after the user confirmed
```

Upgrade a fragment to a later archive, and roll back while no migration has run. The host stores archives and the profile, and runs migrations:

```ts
const kernel = createKernel({
  platform,
  archives: hostArchiveStore, // content-addressed; createMemoryArchiveStore() by default
  profile: hostProfile, // system.profile's storage; createMemoryProfile() by default
  migrate: async (fragment, migration) => {
    // with the new archive in place and the fragment inactive
    await fragmentHost.applyClassMigration(fragment.id, migration); // new/renamed/deleted classes
    await fragmentHost.runDataMigration(fragment.id, migration.tag); // the fragment's own, same tag
  },
});

try {
  await kernel.upgrade("org.example.fragment-pdf", pdfArchiveV2);
} catch (error) {
  if (error instanceof FragmentDeletesClassesError && (await confirmDeletion(error.deletions))) {
    await kernel.upgrade("org.example.fragment-pdf", pdfArchiveV2, { confirmDeletedClasses: true });
  }
}
await kernel.rollback("org.example.fragment-pdf"); // FragmentRollbackError once a migration ran
```

An owner opens an extension point in one aspect file, another fragment extends it in the same aspect. The owner's `fragment.client.jsonc` (its `fragment.jsonc` lists `"client": {}` among its aspects):

```jsonc
{
  "$schema": "./node_modules/@statewalker/kernel.core/schemas/fragment-aspect.v1.schema.json",
  "extensionPoints": {
    "exporters": {
      "description": "Ways to export a note",
      "schema": { "type": "object", "required": ["label"], "properties": { "label": { "type": "string" } } }
    }
  }
}
```

The contributor's `fragment.client.jsonc`, with no `requires` on the owner:

```jsonc
{
  "$schema": "./node_modules/@statewalker/kernel.core/schemas/fragment-aspect.v1.schema.json",
  "extensions": [
    {
      "point": "org.statewalker.fragment-notes/exporters",
      "data": { "label": "Markdown" },
      "reference": { "module": "./export-markdown.js", "export": "exportMarkdown" }
    }
  ]
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

`fragment.jsonc` is JSONC (comments and trailing commas). Its `$schema` names the schema by file name: a value ending in `fragment.v1.schema.json` is version 1, wherever the file is served from, so the URL stays neutral and each distribution hosts it where it likes. The schema is JSON Schema 2020-12, with no namespace key; it fixes the aspects (`server`, `client`, `agent`, each with an optional `dir`) and refuses unknown keys. The kernel then checks what the schema cannot: `version` is semver, `engines.platform` and every `requires` value are semver ranges. Each aspect other than the server's has its own file beside it (`fragment.client.jsonc`, `fragment.agent.jsonc`, see Extensions), read into `InstalledFragment.aspects`.

### Refusals

An install is a list of archives, accepted or refused as a whole. A `FragmentInstallError` carries every refusal, each with a code:

- `invalid-manifest`: no `fragment.jsonc`, JSONC that does not parse, an unknown `$schema` version, a schema violation, a bad version or range; the same for an aspect file, a client or agent aspect without its file, an aspect file without its aspect, or one point name opened in two aspects;
- `invalid-id`: not reverse-domain (two or more segments of `a-z`, `0-9` and inner `-`, each starting with a letter);
- `reserved-id`: a `system.*` id from a fragment not passed as `core`;
- `worker-name`: a server aspect whose `wrangler.jsonc` is missing, names its Worker other than `workerNameOf(id)` (the id with dots turned into hyphens), takes a name another fragment has, or would be longer than 63 characters;
- `incompatible-platform`, `missing-binding`: `engines.platform` or `bindings` that this host does not meet;
- `unmet-requirement`: a required fragment neither installed nor in the same install, or in a version outside the range;
- `already-installed`: one version per fragment per host;
- `extension-point-conflict`: a core fragment opening a short point another core fragment opens.
- `pending-migrations`: a reinstall over data kept from an earlier install, whose archive brings migration tags that data has not had;
- `data-too-new`: an install or an upgrade whose archive lacks migration tags the fragment's data has had (or may have had: started, failed), so its code would run on data migrated past it;
- `not-an-upgrade` (upgrades only): an archive of another fragment, or of a version not later than the installed one.

### Lifecycle as slot membership

Each state is a keyed slot, and a fragment is in every slot whose state it has reached: an active fragment is also installed, enabled and resolved. Every slot holds the same frozen `InstalledFragment`, so a state change is one register or dispose and nothing briefly disappears.

- **Resolved**: enabled, and every required fragment resolved in a version inside its range. A cycle never resolves.
- **Active**: per aspect. `activate(aspect, id?)` runs the host's activator for the aspect, requirements first (a stable topological sort carried over from sandclaw's `kernel.core`); the fragment joins the slot once the activator has finished.
- **Failed**: per aspect. A fragment whose activator throws stays inactive, joins `failedFragmentsSlot(aspect)` with the error (a `FragmentFailure`) and is reported to `onError`. The fragments requiring it, directly or through fragments that lack the aspect, are not activated in that aspect: those an activation was asked for join `waitingFragmentsSlot(aspect)` (a `FragmentWaiting`, whose `blockers` are the requirements with the aspect that are not active), so a fragment waiting for a failed one is told apart from one nobody asked to activate. Every other fragment is activated (carried over from `backbone.core`). Other aspects and the resolved state do not change. `retry(aspect, id?)` activates the failed fragment again (or every failed one of the aspect), then the fragments waiting for it, which leave the waiting slot as they activate; one still failing stays failed with the new error. Deactivating, disabling, removing and `stop` return a failed or waiting aspect to inactive.
- **Deactivation** runs in reverse activation order: `deactivate(aspect, id)` first deactivates the fragments requiring `id` (again also through fragments that lack the aspect), `stop()` deactivates everything. Cleanups that throw are reported and the rest goes on.
- **Disable** cascades only once confirmed. `dependentsOf(id)` lists the resolved fragments requiring it, directly or not, in dependency order; without `{ cascade: true }` a disable with dependents changes nothing and rejects with a `FragmentCascadeError` carrying them. Confirmed, they are deactivated first and become unresolved, staying enabled.
- **Core fragments** cannot be disabled, except those in `DISABLEABLE_CORE` (only `system.agents`, so the platform runs without AI; statewalker-root ADR 2026-11-20-kernel-and-core-fragments).
- **Remove** deactivates, disables and uninstalls a fragment, with the same confirmed cascade (its dependents stay installed and enabled, unresolved). Core fragments cannot be removed, nor can the application's baseline fragments (`KernelOptions.baseline`, the ids the host installs on first run), which can still be disabled. The fragment's data and profile entries are kept by default, so a reinstall finds them: the kernel stores no data, and only `remove(id, { withData: true })` (the user's separate confirmation) calls the host's `KernelOptions.removeData` with the fragment, once it is gone. A host without `removeData` refuses `withData` before anything changes; an error from `removeData` rejects the removal, the fragment staying removed.
- **Repair.** On disable and removal the extension registry repairs itself from the slots: the fragment's static and runtime extensions leave every point, each owner's `observe` receiving them as `removed`; their refusals go too; extensions to its points go dormant, with their refusals, and come back when it does; no other extension, point or state changes. The commands, keybindings, menus, settings pages, views, layouts and agent tools of the core fragments are extensions to their points, so they go the same way.

### Archives, the profile and upgrades

**Archives.** An install's input is an archive's files by name, as text. The kernel names it by `archiveHash`: `sha256:` and the hex SHA-256 (Web Crypto) of the UTF-8 JSON text of `[[name, text], ...]` sorted by name (UTF-16 code units). Every archive installed, upgraded to or rolled back to is put in the host's `ArchiveStore` under that hash, and `InstalledFragment.archive` carries it. The store is content-addressed and immutable: other files under a stored hash are refused (the in-memory store checks the hash), and the kernel deletes nothing, so the archive an upgrade replaced stays there (removal keeps archives too; collecting unused ones is the host's business).

**The profile.** The kernel stays storage-free: it writes JSON values to the host's `KernelProfile` (get, set, delete by key), which `system.profile` keeps with the user's settings.

- `fragments/<id>` (`fragmentRecordKey`) holds a `FragmentRecord`: `version`, `archive`, `enabled`, and after an upgrade `upgrade: { from: { version, archive }, migrations }`, the archive it replaced and the tags it ran. Written on install (enabled `false`), enable, disable, upgrade and rollback; deleted on removal.
- `migrations/<id>` (`appliedMigrationsKey`) holds the fragment's data's `MigrationState`: `{ applied, started?, failed? }`, the tags applied in order, a tag started whose end was never recorded, and a tag whose migration threw. It describes the data, so a removal keeps it unless the data goes too (`withData`), and then only once `removeData` has succeeded.

The kernel records the profile but does not restore from it: a host reinstalls the recorded archives from its store on start.

**Migrations** are the `migrations` of the server half's `wrangler.jsonc`, as on Cloudflare: entries with distinct string `tag`s and class changes (`new_classes`, `new_sqlite_classes`, `renamed_classes`, `deleted_classes`, `transferred_classes`), in order; a list that is not one, or a tag missing or repeated, is refused (`invalid-manifest`). A tag also keys the fragment's own data migrations, so a tag without class changes is a data migration alone. An install runs none: a new project's tags are recorded as applied (the runtime creates its classes as they end up). A reinstall over kept data whose archive brings tags the record lacks is refused (`pending-migrations`): reinstall the removed version, then upgrade. An install or upgrade whose archive lacks a tag the data has had is refused (`data-too-new`): there is no going back after a migration, by rollback or by reinstall.

**Activation needs migrated data.** Before running an activator the kernel checks the fragment's archive tags against `migrations/<id>`: when some are not applied, or a migration is unfinished, the aspect is failed with a `FragmentMigrationsPendingError` (its `pending` tags, its `unfinished` one), the activator does not run, and its dependents wait, as for any failure. `enable` is not gated: it runs no code.

**Upgrade.** `upgrade(id, files, options?)` takes a later version of an installed, non-core fragment (`not-an-upgrade` otherwise). The archive passes the install checks (platform, bindings, requirements, Worker name), and every installed fragment requiring it must accept the new version (`unmet-requirement`); a refusal is a `FragmentInstallError` and nothing changes. The tags the record lacks are pending: on a host without `KernelOptions.migrate` they refuse the upgrade, and those with `deleted_classes` refuse it with a `FragmentDeletesClassesError` listing the classes unless `{ confirmDeletedClasses: true }` confirms it, again changing nothing. Then:

1. the archive is stored, and the fragment and the fragments requiring it are deactivated in every aspect, dependents first;
2. the archive is swapped: in each state slot it is in, the fragment is disposed and the new one registered (see below);
3. each pending tag is recorded as `started`, runs through `migrate`, then moves to `applied` and to the record's `upgrade.migrations`;
4. what was active is activated again, requirements first.

A migration that throws stops the upgrade with a `FragmentMigrationError` (its `tag` and `cause`), recorded as `failed`: the new archive stays installed, nothing is activated again (activation is gated, see above), and the tags that ran before stay recorded. Upgrading to the same archive again resumes: it runs the tags still pending, the failed one first, keeping the upgrade's `from` and the tags it ran. Any other archive of the same version, or the same one with nothing pending, is `not-an-upgrade`.

A `started` tag that never got its end recorded (the process died, a profile write failed) may or may not have run. The kernel never reruns it or rolls back over it: an upgrade is refused with a `FragmentMigrationsPendingError` naming it `unfinished`, and activation is gated, until the host checks the data and writes `migrations/<id>` itself (the tag in `applied`, or `started` dropped).

**Rollback.** `rollback(id)` goes back to the record's `upgrade.from`, read from the store, the same way (deactivate, swap, activate again), and clears `upgrade`. It is refused with a `FragmentRollbackError`, nothing changed and the upgraded version still active, when no upgrade is recorded, when a migration has run on the data or may have (`migrations` lists them: one the upgrade ran, one started or failed, one applied that the previous archive lacks; Durable Object migrations do not run backwards, so the old code would meet migrated data), or when the store lacks the archive. Only the last upgrade rolls back; one that ran no migration can be rolled back even when an earlier one ran some.

**An upgrade in the slots** is dispose plus register, as ADR 2026-11-20-fragment-lifecycle §6 says: keyed slots refuse a new value under an existing id and `shared-slots` has no `replace`. An observer of `installed`, `enabled` or `resolved` sees the fragment leave and come back within the upgrade, synchronously, and it moves to the end of the slot's registration order. Nothing in the kernel misreads this: the fragment and its dependents are already inactive, and an owner of a point it extends sees its extensions removed, then added in their new version, which an upgrade changes anyway. A `replace` in `shared-slots` is worth adding only if an observer turns out to treat the gap as a removal.

Operations run one after another, in the order they were called. An operation called while an activator or a cleanup runs is rejected at once with a `FragmentLifecycleError`: an activator that awaited the kernel would otherwise wait for its own operation forever. This also refuses a call from elsewhere that lands while a hook runs; call again once the running operation has settled.

### Extensions

Points and extensions live in the **aspect files**, one per aspect at the archive's root, each with its own versioned `$schema` (`fragment-aspect.v<N>.schema.json`, JSON Schema 2020-12) and validated at install, all or nothing like the manifest. `fragment.client.jsonc` and `fragment.agent.jsonc` are required for each of those aspects `fragment.jsonc` lists; the server aspect's file is `wrangler.jsonc`, standard wrangler that cannot carry them, so its points and extensions go in an optional `fragment.server.jsonc` beside it. An aspect file without its aspect in `fragment.jsonc` is refused, and `fragment.jsonc` keeps only the aspects present (with `dir`).

A fragment opens **extension points** in one aspect, under `extensionPoints` of that aspect's file: a name (`a-z`, `0-9`, inner `-`) and a JSON Schema (2020-12). A point's id is `<fragment-id>/<name>`; a core fragment's point is known by its short name alone (`menus`), and two core fragments cannot open the same one (`extension-point-conflict`). A name is opened in one aspect only, since the id carries no aspect.

A fragment contributes **extensions** to points of the same aspect, under `extensions` of that aspect's file, or at runtime by registering an `ExtensionContribution` in `extensionContributionsSlot(aspect)` under the key `<contributor>/<name>`. An extension is `data` plus an optional `reference`: a client module export (`{ module, export? }`), a server entrypoint method reached through a service binding (`{ entrypoint, method }`), or a command (`{ command }`). Contributing needs no `requires`.

The registry is computed from public state: an extension is **live** while its contributor and the point's owner are resolved (and, for a runtime one, while it stays registered). An extension whose point is not open is **dormant**: nothing is reported, and it is checked once the owner resolves. A live extension's data must match the point's schema; one that does not, one in the wrong aspect and a malformed runtime contribution are **refused**, published in `extensionRefusalsSlot(aspect)` with a code and a message while the contributor and point are there (a malformed runtime contribution, while the fragment it names or whose key it has is resolved). Extensions read in a stable order: static ones in resolution order, then runtime ones in registration order.

The owner gets its points from the context its activator receives (`context.extensions`), only for the aspect being activated, and nobody else gets them. `read(name)` is synchronous and `observe(name, listener)` calls the listener at once, then with `added` and `removed` on every change; both work while the activator runs, when every kernel operation is refused, because they read state and change nothing. A listener that throws is reported to `onError`. When the aspect is deactivated (or its activator throws) the handle closes: reads are empty and listeners stop.

A **reference** is handed only to the owner, as `extension.reference`. The kernel loads no code: `resolve()` goes through the host's resolver for the kind (`KernelOptions.resolvers`), and `call(...args)` resolves a function and calls it. A reference is usable while its extension is live and the owner's handle is open. Otherwise `ExtensionUnavailable` is raised: on `resolve` and `call`, on a function resolved earlier, for a kind the host does not resolve, and for a resolution or a call still pending when the extension goes, so nothing waits on a fragment that has left.

### Dependencies

- `@statewalker/shared-slots`: the slot bus.
- `@cfworker/json-schema`: JSON Schema 2020-12 validation without code generation, so it runs under a strict CSP and in Workers.
- `jsonc-parser`: VS Code's JSONC parser.
- `semver`: npm's semver.

## License

MIT. See [LICENSE](../../LICENSE).
