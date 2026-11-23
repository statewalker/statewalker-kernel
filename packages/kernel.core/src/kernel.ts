import { Slots } from "@statewalker/shared-slots";
import semver from "semver";
import { type ArchiveStore, archiveHash, createMemoryArchiveStore } from "./archives.js";
import {
  FragmentCascadeError,
  FragmentDeletesClassesError,
  FragmentInstallError,
  FragmentLifecycleError,
  FragmentMigrationError,
  FragmentRollbackError,
  type Refusal,
} from "./errors.js";
import {
  createExtensionRegistry,
  type ExtensionRegistryOptions,
  type OwnedExtensionPoints,
} from "./extensions.js";
import { isFragmentId, isSystemId, MAX_WORKER_NAME_LENGTH, workerNameOf } from "./ids.js";
import {
  ASPECTS,
  type Aspect,
  type FragmentFiles,
  type FragmentManifest,
  type InstalledFragment,
} from "./manifest.js";
import { type ClassMigration, readMigrations } from "./migrations.js";
import { orderNodes } from "./order.js";
import { parseJsonc, readAspectFiles, readManifest } from "./parse-manifest.js";
import {
  appliedMigrationsKey,
  createMemoryProfile,
  type FragmentRecord,
  fragmentRecordKey,
  type KernelProfile,
} from "./profile.js";
import {
  activeFragmentsSlot,
  enabledFragmentsSlot,
  failedFragmentsSlot,
  installedFragmentsSlot,
  resolvedFragmentsSlot,
  waitingFragmentsSlot,
} from "./slots.js";

/** What the host offers fragments. */
export interface PlatformInfo {
  /** The platform version `engines.platform` ranges are checked against. */
  readonly version: string;
  /** The bindings this host offers; a fragment requiring another is refused. */
  readonly bindings: readonly string[];
}

/** What activating an aspect may return: its cleanup, or nothing. */
export type AspectCleanup = () => void | Promise<void>;

/**
 * The host's code that activates one aspect of a fragment (imports the client half,
 * mounts the agent plugins, wakes the server half...). It may return a cleanup, run
 * when the aspect is deactivated.
 */
export type AspectActivator = (
  fragment: InstalledFragment,
  context: ActivationContext,
  // biome-ignore lint/suspicious/noConfusingVoidType: lets activators without a `return` type-check.
) => AspectCleanup | undefined | void | Promise<AspectCleanup | undefined | void>;

/** What an activator receives beside the fragment. */
export interface ActivationContext {
  readonly aspect: Aspect;
  /**
   * The extension points the fragment opens in this aspect, with their extensions. Only
   * the owner gets them. Reading is synchronous and allowed while the activator runs.
   */
  readonly extensions: OwnedExtensionPoints;
}

export interface KernelOptions extends ExtensionRegistryOptions {
  readonly platform: PlatformInfo;
  /** The slot bus the lifecycle state is published on; a new one by default. */
  readonly slots?: Slots;
  /**
   * The fragments shipped with the platform (the core fragments), installed and
   * enabled by `start`. Only these may use the reserved `system.` prefix.
   */
  readonly core?: readonly FragmentFiles[];
  /** The host's activator per aspect; an aspect without one only changes state. */
  readonly activators?: Partial<Record<Aspect, AspectActivator>>;
  /**
   * Called when an activator or a cleanup throws. The aspect stays inactive, the
   * fragments requiring it are not activated, and every other fragment carries on.
   */
  readonly onError?: (id: string, aspect: Aspect, error: unknown) => void;
  /**
   * The host's code that deletes a removed fragment's data (its Durable Object data and
   * its profile entries: settings values, secrets). The kernel keeps no data itself; it
   * calls this only for a removal with `{ withData: true }`, once the fragment is gone.
   */
  readonly removeData?: (fragment: InstalledFragment) => void | Promise<void>;
  /**
   * The host's content-addressed store of installed archives; one in memory by default.
   * Every archive installed or upgraded to is stored under its hash and kept.
   */
  readonly archives?: ArchiveStore;
  /**
   * Where the kernel records each installed fragment's version, archive and enabled state,
   * its last upgrade and the migration tags applied to its data; one in memory by default.
   */
  readonly profile?: KernelProfile;
  /**
   * The host's code that runs one migration of a fragment being upgraded, with the new
   * archive in place and every aspect of it inactive: the Durable Object class changes of
   * the tag (on CellB, the fragment host; on Cloudflare, the deploy) and the fragment's
   * own data migrations keyed by the same tag. Each tag is run once and recorded; an
   * upgrade bringing tags to run is refused on a host without it.
   */
  readonly migrate?: (
    fragment: InstalledFragment,
    migration: ClassMigration,
  ) => void | Promise<void>;
}

/** How to upgrade a fragment. */
export interface UpgradeOptions {
  /**
   * Confirms running migrations with `deleted_classes`, which delete those Durable Object
   * classes' data. Without it such an upgrade is refused with a
   * `FragmentDeletesClassesError` and nothing changes.
   */
  readonly confirmDeletedClasses?: boolean;
}

/** How to remove a fragment. */
export interface RemoveOptions {
  /** Confirms deactivating and unresolving the fragments requiring it (see `dependentsOf`). */
  readonly cascade?: boolean;
  /**
   * Confirms "remove with data": the host's `removeData` deletes the fragment's data and
   * profile entries. Without it they are kept, so a reinstall finds them.
   */
  readonly withData?: boolean;
}

export interface Kernel {
  /** The bus holding the lifecycle state (`system:fragments:*`). */
  readonly slots: Slots;
  /** Install and enable the core fragments. */
  start(): Promise<void>;
  /**
   * Install fragments, all or nothing: any refusal rejects with a `FragmentInstallError`
   * listing every reason, and nothing is installed.
   */
  install(archives: readonly FragmentFiles[]): Promise<InstalledFragment[]>;
  /** Enable an installed fragment; it resolves once everything it requires has. */
  enable(id: string): Promise<void>;
  /**
   * Disable a fragment. When resolved fragments require it, nothing changes unless
   * `cascade` confirms it: they are then deactivated first and become unresolved.
   */
  disable(id: string, options?: { cascade?: boolean }): Promise<void>;
  /**
   * Remove an installed fragment: deactivate it (its dependents first, with `cascade`),
   * disable it and uninstall it. Its data is kept unless `withData` confirms deleting it.
   * Refused, with nothing changed, for a core fragment, for one resolved fragments
   * require without `cascade` (a `FragmentCascadeError`), and for `withData` on a host
   * without `removeData`.
   */
  remove(id: string, options?: RemoveOptions): Promise<void>;
  /**
   * The resolved fragments requiring `id`, directly or not, in dependency order: what a
   * disable or a removal of `id` would cascade to. Read it to list them before confirming.
   */
  dependentsOf(id: string): string[];
  /**
   * Activate `aspect` of fragment `id` (and first of the fragments it requires), or of
   * every resolved fragment, in dependency order.
   */
  activate(aspect: Aspect, id?: string): Promise<void>;
  /**
   * Deactivate `aspect` of fragment `id` (and first of the fragments requiring it), or
   * of every fragment, in reverse activation order.
   */
  deactivate(aspect: Aspect, id?: string): Promise<void>;
  /**
   * Activate again `aspect` of the failed fragment `id` (refused when it has not failed),
   * or of every failed fragment, then of the fragments an activation left waiting for it.
   * One still failing stays failed with its new error.
   */
  retry(aspect: Aspect, id?: string): Promise<void>;
  /** Deactivate every aspect of every fragment, in reverse activation order. */
  stop(): Promise<void>;
  /**
   * Upgrade an installed fragment to the archive `files`: deactivate it (its dependents
   * first), swap the archive, run the migrations it brings, and activate again what was
   * active. The previous archive stays in the store.
   */
  upgrade(id: string, files: FragmentFiles, options?: UpgradeOptions): Promise<InstalledFragment>;
  /**
   * Go back to the archive the last upgrade replaced: deactivate, swap it back, activate
   * again. Refused with a `FragmentRollbackError`, nothing changed, when no upgrade is
   * recorded or once the upgrade has run a migration.
   */
  rollback(id: string): Promise<InstalledFragment>;
}

// Every operation runs after the ones called before it. One called while an activator or a
// cleanup runs (from inside it, or from anywhere else at that moment) is rejected at once
// with a FragmentLifecycleError instead of waiting: an activator awaiting the kernel would
// otherwise wait for itself.

const RANGE_OPTIONS = { includePrerelease: true };

export function createKernel(options: KernelOptions): Kernel {
  const slots = options.slots ?? new Slots();
  const archiveStore = options.archives ?? createMemoryArchiveStore();
  const profile = options.profile ?? createMemoryProfile();
  async function readRecord(id: string): Promise<FragmentRecord | undefined> {
    return (await profile.get(fragmentRecordKey(id))) as FragmentRecord | undefined;
  }
  async function writeRecord(id: string, record: FragmentRecord): Promise<void> {
    await profile.set(fragmentRecordKey(id), record);
  }
  async function readApplied(id: string): Promise<string[] | undefined> {
    return (await profile.get(appliedMigrationsKey(id))) as string[] | undefined;
  }
  /**
   * The refusal of an archive whose migrations lack tags the fragment's data has had: its
   * code would run on data migrated past it (no rollback after migrations).
   */
  function dataTooNew(
    manifest: FragmentManifest,
    tags: readonly string[],
    applied: readonly string[],
  ): Refusal | undefined {
    const unknown = applied.filter((tag) => !tags.includes(tag));
    if (unknown.length === 0) return undefined;
    return {
      id: manifest.id,
      code: "data-too-new",
      message: `"${manifest.id}" ${manifest.version} lacks the migrations ${unknown.join(", ")}, which its data has had`,
    };
  }
  async function recordEnabled(id: string, enabled: boolean): Promise<void> {
    const record = await readRecord(id);
    if (record && record.enabled !== enabled) await writeRecord(id, { ...record, enabled });
  }
  const memberships = new Map<string, () => void>();

  const cleanups = new Map<string, AspectCleanup>();
  /** The extension points handed to each active (or activating) aspect of a fragment. */
  const handles = new Map<string, { close(): void }>();
  function closeHandle(aspect: Aspect, id: string) {
    const key = `${aspect}\u0000${id}`;
    handles.get(key)?.close();
    handles.delete(key);
  }
  const onError =
    options.onError ??
    ((id: string, aspect: Aspect, error: unknown) =>
      console.error(`[kernel] "${id}" (${aspect}):`, error));

  const registry = createExtensionRegistry(slots, options, onError);

  /**
   * The fragments an activation was asked for but skipped because a requirement was not
   * active (failed, or waiting itself), published in `waitingFragmentsSlot`, which `retry`
   * reads: each entry's blockers and disposer.
   */
  const waiting = new Map<string, { blockers: string; dispose: () => void }>();
  function wait(aspect: Aspect, fragment: InstalledFragment, blockers: string[]) {
    const key = `${aspect}\u0000${fragment.id}`;
    const held = waiting.get(key);
    if (held?.blockers === blockers.join("\u0000")) return;
    stopWaiting(aspect, fragment.id);
    const dispose = slots.register(waitingFragmentsSlot(aspect), fragment.id, {
      fragment,
      aspect,
      blockers,
    });
    waiting.set(key, { blockers: blockers.join("\u0000"), dispose });
  }
  function stopWaiting(aspect: Aspect, id: string) {
    const key = `${aspect}\u0000${id}`;
    waiting.get(key)?.dispose();
    waiting.delete(key);
  }

  /** Ids active per aspect, in activation order. */
  const activeOrder = new Map<Aspect, string[]>(ASPECTS.map((a) => [a, []]));

  type Decl = ReturnType<typeof activeFragmentsSlot>;
  function join(decl: Decl, fragment: InstalledFragment) {
    const key = `${decl.key}\u0000${fragment.id}`;
    if (!memberships.has(key)) memberships.set(key, slots.register(decl, fragment.id, fragment));
  }
  function leave(decl: Decl, id: string) {
    const key = `${decl.key}\u0000${id}`;
    memberships.get(key)?.();
    memberships.delete(key);
  }
  /** The failures published per aspect, each with its disposer. */
  const failures = new Map<string, () => void>();
  function fail(aspect: Aspect, fragment: InstalledFragment, error: unknown) {
    clearFailure(aspect, fragment.id);
    const dispose = slots.register(failedFragmentsSlot(aspect), fragment.id, {
      fragment,
      aspect,
      error,
    });
    failures.set(`${aspect}\u0000${fragment.id}`, dispose);
  }
  function clearFailure(aspect: Aspect, id: string) {
    const key = `${aspect}\u0000${id}`;
    failures.get(key)?.();
    failures.delete(key);
  }
  function has(decl: Decl, id: string): boolean {
    return slots.getSnapshot(decl).has(id);
  }
  function requiresOf(f: InstalledFragment): string[] {
    return Object.keys(f.manifest.requires ?? {});
  }
  /** Fragments of `decl` in dependency order. */
  function ordered(decl: Decl): InstalledFragment[] {
    const nodes = [...slots.getSnapshot(decl).values()].map((f) => ({
      id: f.id,
      requires: requiresOf(f),
      f,
    }));
    return orderNodes(nodes).map((n) => n.f);
  }
  /** `ids` plus every fragment of `decl` requiring one of them, transitively. */
  function withDependents(decl: Decl, ids: readonly string[]): Set<string> {
    const result = new Set(ids);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of slots.getSnapshot(decl).values()) {
        if (!result.has(f.id) && requiresOf(f).some((r) => result.has(r))) {
          result.add(f.id);
          grew = true;
        }
      }
    }
    return result;
  }
  /** `id` plus every fragment of `decl` it requires, transitively. */
  function withRequirements(decl: Decl, id: string): Set<string> {
    const result = new Set([id]);
    const queue = [id];
    while (queue.length > 0) {
      const f = slots.get(decl, queue.shift() as string);
      for (const dep of f ? requiresOf(f) : []) {
        if (!result.has(dep) && has(decl, dep)) {
          result.add(dep);
          queue.push(dep);
        }
      }
    }
    return result;
  }

  /**
   * Bring `resolved` up to date with `enabled`. A fragment is resolved when it is enabled
   * and every fragment it requires is resolved in a version inside the range. Fragments
   * that stop being resolved leave first (dependents before their requirements), then the
   * newly resolved join (requirements before their dependents).
   */
  function resolve(): void {
    const keep = new Set<string>();
    const meets = (f: InstalledFragment) =>
      Object.entries(f.manifest.requires ?? {}).every(([dep, range]) => {
        const found = installed(dep);
        return (
          keep.has(dep) && !!found && semver.satisfies(found.manifest.version, range, RANGE_OPTIONS)
        );
      });
    const enabled = ordered(enabledFragmentsSlot);
    for (const f of enabled) if (meets(f)) keep.add(f.id);
    for (const f of ordered(resolvedFragmentsSlot).reverse()) {
      if (!keep.has(f.id)) leave(resolvedFragmentsSlot, f.id);
    }
    for (const f of enabled) if (keep.has(f.id)) join(resolvedFragmentsSlot, f);
  }

  async function activateOne(aspect: Aspect, f: InstalledFragment): Promise<void> {
    const slot = activeFragmentsSlot(aspect);
    if (has(slot, f.id)) return;
    // Every requirement, direct or through fragments lacking the aspect, that has the
    // aspect must be active first.
    const requirements = withRequirements(resolvedFragmentsSlot, f.id);
    const blockers = ordered(resolvedFragmentsSlot)
      .map((r) => r.id)
      .filter(
        (dep) =>
          dep !== f.id &&
          requirements.has(dep) &&
          installed(dep)?.manifest.aspects[aspect] !== undefined &&
          !has(slot, dep),
      );
    if (blockers.length > 0) {
      wait(aspect, f, blockers);
      return;
    }
    stopWaiting(aspect, f.id);
    try {
      const activator = options.activators?.[aspect];
      const owned = registry.ownedBy(f, aspect);
      handles.set(`${aspect}\u0000${f.id}`, owned);
      const cleanup = await hook(() => activator?.(f, { aspect, extensions: owned.points }));
      if (typeof cleanup === "function") cleanups.set(`${aspect}\u0000${f.id}`, cleanup);
    } catch (error) {
      closeHandle(aspect, f.id);
      fail(aspect, f, error);
      onError(f.id, aspect, error);
      return;
    }
    clearFailure(aspect, f.id);
    join(slot, f);
    activeOrder.get(aspect)?.push(f.id);
  }

  async function deactivateAll(aspect: Aspect, ids: ReadonlySet<string> | undefined) {
    // Failed and waiting fragments return to inactive too.
    for (const id of slots.getSnapshot(failedFragmentsSlot(aspect)).keys()) {
      if (!ids || ids.has(id)) clearFailure(aspect, id);
    }
    for (const id of slots.getSnapshot(waitingFragmentsSlot(aspect)).keys()) {
      if (!ids || ids.has(id)) stopWaiting(aspect, id);
    }
    const order = activeOrder.get(aspect) ?? [];
    for (const id of [...order].reverse()) {
      if (ids && !ids.has(id)) continue;
      order.splice(order.lastIndexOf(id), 1);
      const key = `${aspect}\u0000${id}`;
      const cleanup = cleanups.get(key);
      cleanups.delete(key);
      try {
        await hook(() => cleanup?.());
      } catch (error) {
        onError(id, aspect, error);
      }
      leave(activeFragmentsSlot(aspect), id);
      closeHandle(aspect, id);
    }
  }

  function installed(id: string): InstalledFragment | undefined {
    return slots.get(installedFragmentsSlot, id) ?? undefined;
  }

  /** Refusals of installing `entries` together, beside what is already installed. */
  function checkInstall(
    entries: readonly {
      manifest: FragmentManifest;
      files: FragmentFiles;
      aspects: InstalledFragment["aspects"];
    }[],
    core: boolean,
    /** The installed fragment the entry replaces (an upgrade or a rollback). */
    replacing?: string,
  ): Refusal[] {
    const refusals: Refusal[] = [];
    const batch = new Map<string, FragmentManifest>();
    const workerNames = new Map<string, string>();
    for (const f of slots.getSnapshot(installedFragmentsSlot).values()) {
      if (f.manifest.aspects.server && f.id !== replacing) {
        workerNames.set(workerNameOf(f.id), f.id);
      }
    }
    for (const { manifest: m, files } of entries) {
      const refuse = (code: Refusal["code"], message: string) =>
        refusals.push({ id: m.id, code, message });
      if (!isFragmentId(m.id)) {
        refuse("invalid-id", `"${m.id}" is not a reverse-domain id (org.example.fragment-name)`);
        continue;
      }
      if (isSystemId(m.id) && !core) {
        refuse(
          "reserved-id",
          `"${m.id}": the system. prefix is reserved for the platform's core fragments`,
        );
        continue;
      }
      if ((installed(m.id) && m.id !== replacing) || batch.has(m.id)) {
        refuse("already-installed", `"${m.id}" is already installed`);
        continue;
      }
      batch.set(m.id, m);
      if (m.aspects.server) {
        const expected = workerNameOf(m.id);
        const wrangler = files["wrangler.jsonc"];
        const name =
          wrangler === undefined
            ? undefined
            : (parseJsonc(wrangler).value as { name?: unknown } | undefined)?.name;
        if (expected.length > MAX_WORKER_NAME_LENGTH) {
          refuse(
            "worker-name",
            `"${m.id}": its Worker name "${expected}" is longer than ${MAX_WORKER_NAME_LENGTH} characters`,
          );
        } else if (wrangler === undefined) {
          refuse("worker-name", `"${m.id}" has a server aspect but no wrangler.jsonc`);
        } else if (name !== expected) {
          refuse(
            "worker-name",
            `"${m.id}": wrangler.jsonc names the Worker ${JSON.stringify(name)}, not "${expected}"`,
          );
        } else if (workerNames.has(expected)) {
          refuse(
            "worker-name",
            `"${m.id}": the Worker name "${expected}" is taken by "${workerNames.get(expected)}"`,
          );
        } else {
          workerNames.set(expected, m.id);
        }
      }
    }
    // Core points are known by their short name, so two core fragments cannot share one.
    const shortPoints = new Map<string, string>();
    const corePoints = (id: string, aspects: InstalledFragment["aspects"]) =>
      isSystemId(id) ? ASPECTS.flatMap((a) => Object.keys(aspects[a]?.extensionPoints ?? {})) : [];
    for (const f of slots.getSnapshot(installedFragmentsSlot).values()) {
      for (const name of corePoints(f.id, f.aspects)) shortPoints.set(name, f.id);
    }
    for (const { manifest: m, aspects } of entries) {
      if (batch.get(m.id) !== m) continue;
      for (const name of corePoints(m.id, aspects)) {
        const other = shortPoints.get(name);
        if (other) {
          refusals.push({
            id: m.id,
            code: "extension-point-conflict",
            message: `"${m.id}" opens the extension point "${name}", which "${other}" opens`,
          });
        } else {
          shortPoints.set(name, m.id);
        }
      }
    }
    for (const m of batch.values()) {
      const refuse = (code: Refusal["code"], message: string) =>
        refusals.push({ id: m.id, code, message });
      const platform = options.platform.version;
      if (!semver.satisfies(platform, m.engines.platform, RANGE_OPTIONS)) {
        refuse(
          "incompatible-platform",
          `"${m.id}" needs platform ${m.engines.platform}; this platform is ${platform}`,
        );
      }
      const offered = new Set(options.platform.bindings);
      for (const binding of m.bindings ?? []) {
        if (!offered.has(binding)) {
          refuse(
            "missing-binding",
            `"${m.id}" needs the binding "${binding}", which this host lacks`,
          );
        }
      }
      for (const [dep, range] of Object.entries(m.requires ?? {})) {
        const found = batch.get(dep) ?? installed(dep)?.manifest;
        if (!found) {
          refuse(
            "unmet-requirement",
            `"${m.id}" requires "${dep}" ${range}, which is not installed`,
          );
        } else if (!semver.satisfies(found.version, range, RANGE_OPTIONS)) {
          refuse(
            "unmet-requirement",
            `"${m.id}" requires "${dep}" ${range}, but version ${found.version} is installed`,
          );
        }
      }
    }
    return refusals;
  }

  async function install(archives: readonly FragmentFiles[], core: boolean) {
    const refusals: Refusal[] = [];
    const read: {
      manifest: FragmentManifest;
      files: FragmentFiles;
      aspects: InstalledFragment["aspects"];
    }[] = [];
    for (const files of archives) {
      const { manifest, refusal } = readManifest(files);
      if (refusal) {
        refusals.push(refusal);
        continue;
      }
      const aspects = readAspectFiles(files, manifest);
      const { refusal: migrationRefusal } = readMigrations(files, manifest);
      if (migrationRefusal) aspects.refusals.push(migrationRefusal);
      if (aspects.refusals.length > 0) refusals.push(...aspects.refusals);
      else read.push({ manifest, files, aspects: aspects.aspects });
    }
    refusals.push(...checkInstall(read, core));
    // Data kept from an earlier install: the archive may not bring migrations it lacks,
    // since an install runs none (reinstall the removed version, then upgrade).
    for (const { manifest, files } of read) {
      const applied = await readApplied(manifest.id);
      if (applied === undefined) continue;
      const tags = readMigrations(files, manifest).migrations.map((m) => m.tag);
      const tooNew = dataTooNew(manifest, tags, applied);
      if (tooNew) refusals.push(tooNew);
      const pending = tags.filter((tag) => !applied.includes(tag));
      if (pending.length > 0) {
        refusals.push({
          id: manifest.id,
          code: "pending-migrations",
          message: `"${manifest.id}" has data kept from an earlier install, which the migrations ${pending.join(", ")} would change; install the removed version, then upgrade`,
        });
      }
    }
    if (refusals.length > 0) throw new FragmentInstallError(refusals);
    const result: InstalledFragment[] = [];
    for (const { manifest, files, aspects } of read) {
      const archive = await archiveHash(files);
      await archiveStore.put(archive, files);
      result.push(Object.freeze({ id: manifest.id, manifest, files, aspects, core, archive }));
    }
    for (const fragment of result) {
      // A new project starts from its migrations applied (the runtime creates its classes
      // as they end up); tags already recorded are data kept from an earlier install.
      if ((await readApplied(fragment.id)) === undefined) {
        const tags = readMigrations(fragment.files, fragment.manifest).migrations.map((m) => m.tag);
        await profile.set(appliedMigrationsKey(fragment.id), tags);
      }
      await writeRecord(fragment.id, {
        version: fragment.manifest.version,
        archive: fragment.archive,
        enabled: false,
      });
    }
    for (const fragment of result) join(installedFragmentsSlot, fragment);
    return result;
  }

  async function enable(id: string) {
    const fragment = installed(id);
    if (!fragment) throw new FragmentLifecycleError(`"${id}" is not installed`);
    join(enabledFragmentsSlot, fragment);
    resolve();
    await recordEnabled(id, true);
  }

  /** Activators and cleanups running now; while any runs, operations are refused. */
  let hooks = 0;
  async function hook<R>(run: () => R | Promise<R>): Promise<R> {
    hooks++;
    try {
      return await run();
    } finally {
      hooks--;
    }
  }

  let tail: Promise<unknown> = Promise.resolve();
  /**
   * Run `op` after every operation called before it, whatever their outcome. An operation
   * called while an activator or a cleanup runs is refused: it would wait for the running
   * operation, which may be waiting for it (an activator awaiting the kernel).
   */
  function serial<A extends unknown[], R>(op: (...args: A) => Promise<R>) {
    return (...args: A): Promise<R> => {
      if (hooks > 0) {
        return Promise.reject(
          new FragmentLifecycleError(
            "Kernel operations cannot be called while an activator or a cleanup runs",
          ),
        );
      }
      const result = tail.then(() => op(...args));
      tail = result.catch(() => {});
      return result;
    };
  }

  async function disable(id: string, cascade: boolean, action = "disable") {
    if (!has(enabledFragmentsSlot, id)) return;
    const affected = withDependents(resolvedFragmentsSlot, [id]);
    const dependents = dependentsOf(id);
    if (dependents.length > 0 && !cascade) {
      throw new FragmentCascadeError(id, dependents, action);
    }
    for (const aspect of ASPECTS) await deactivateAll(aspect, affected);
    leave(enabledFragmentsSlot, id);
    resolve();
    await recordEnabled(id, false);
  }

  /**
   * Read and check `files` as the next archive of the installed `current` (an upgrade when
   * `upgrading`, else a rollback). Throws a `FragmentInstallError` with the refusals.
   * Changes nothing: the caller stores the archive once every check has passed.
   */
  async function prepareSwap(
    current: InstalledFragment,
    files: FragmentFiles,
    upgrading: boolean,
  ): Promise<InstalledFragment> {
    const { id } = current;
    const { manifest, refusal } = readManifest(files);
    if (refusal) throw new FragmentInstallError([refusal]);
    const aspects = readAspectFiles(files, manifest);
    const { refusal: migrationRefusal } = readMigrations(files, manifest);
    if (migrationRefusal) aspects.refusals.push(migrationRefusal);
    if (aspects.refusals.length > 0) throw new FragmentInstallError(aspects.refusals);
    const notAnUpgrade = (message: string) =>
      new FragmentInstallError([{ id: manifest.id, code: "not-an-upgrade", message }]);
    if (manifest.id !== id) {
      throw notAnUpgrade(`The archive is "${manifest.id}", not "${id}"`);
    }
    if (upgrading && !semver.gt(manifest.version, current.manifest.version)) {
      throw notAnUpgrade(
        `"${id}" ${manifest.version} is not later than the installed ${current.manifest.version}`,
      );
    }
    const refusals = checkInstall([{ manifest, files, aspects: aspects.aspects }], false, id);
    if (upgrading) {
      const tags = readMigrations(files, manifest).migrations.map((m) => m.tag);
      const tooNew = dataTooNew(manifest, tags, (await readApplied(id)) ?? []);
      if (tooNew) refusals.push(tooNew);
    }
    // The installed fragments requiring it must accept the new version.
    for (const f of slots.getSnapshot(installedFragmentsSlot).values()) {
      const range = f.manifest.requires?.[id];
      if (range !== undefined && !semver.satisfies(manifest.version, range, RANGE_OPTIONS)) {
        refusals.push({
          id: f.id,
          code: "unmet-requirement",
          message: `"${f.id}" requires "${id}" ${range}, which ${manifest.version} does not meet`,
        });
      }
    }
    if (refusals.length > 0) throw new FragmentInstallError(refusals);
    const archive = await archiveHash(files);
    return Object.freeze({
      id: current.id,
      manifest,
      files,
      aspects: aspects.aspects,
      core: current.core,
      archive,
    });
  }

  /**
   * Replace the installed `current` by `next` (same id): deactivate it and the fragments
   * requiring it, swap it in every state slot it is in (dispose, then register: observers
   * see it leave and come back), run `between`, then activate again what was active.
   */
  async function swap(
    current: InstalledFragment,
    next: InstalledFragment,
    between: () => Promise<void>,
  ): Promise<void> {
    const affected = withDependents(resolvedFragmentsSlot, [current.id]);
    const wasActive = new Map<Aspect, Set<string>>();
    for (const aspect of ASPECTS) {
      const order = activeOrder.get(aspect) ?? [];
      wasActive.set(aspect, new Set(order.filter((x) => affected.has(x))));
      await deactivateAll(aspect, affected);
    }
    const states = [installedFragmentsSlot, enabledFragmentsSlot, resolvedFragmentsSlot];
    const held = states.filter((decl) => has(decl, current.id));
    for (const decl of [...held].reverse()) leave(decl, current.id);
    for (const decl of held) join(decl, next);
    resolve();
    await between();
    for (const aspect of ASPECTS) {
      const targets = wasActive.get(aspect) ?? new Set();
      for (const f of ordered(resolvedFragmentsSlot)) {
        if (targets.has(f.id) && f.manifest.aspects[aspect]) await activateOne(aspect, f);
      }
    }
  }

  function dependentsOf(id: string): string[] {
    const affected = withDependents(resolvedFragmentsSlot, [id]);
    return ordered(resolvedFragmentsSlot)
      .map((f) => f.id)
      .filter((d) => d !== id && affected.has(d));
  }

  return {
    slots,
    dependentsOf,
    start: serial(async () => {
      const core = await install(options.core ?? [], true);
      for (const fragment of core) await enable(fragment.id);
    }),
    install: serial((archives: readonly FragmentFiles[]) => install(archives, false)),
    enable: serial(enable),
    disable: serial((id: string, { cascade = false }: { cascade?: boolean } = {}) =>
      disable(id, cascade),
    ),
    remove: serial(
      async (id: string, { cascade = false, withData = false }: RemoveOptions = {}) => {
        const fragment = installed(id);
        if (!fragment) throw new FragmentLifecycleError(`"${id}" is not installed`);
        if (fragment.core) {
          throw new FragmentLifecycleError(`"${id}" ships with the platform and cannot be removed`);
        }
        if (withData && !options.removeData) {
          throw new FragmentLifecycleError(
            `"${id}" cannot be removed with its data: this host removes no fragment data`,
          );
        }
        await disable(id, cascade, "remove");
        leave(installedFragmentsSlot, id);
        await profile.delete(fragmentRecordKey(id));
        if (withData) {
          await hook(() => options.removeData?.(fragment));
          // Only once the data is gone: kept data keeps its record.
          await profile.delete(appliedMigrationsKey(id));
        }
      },
    ),
    activate: serial(async (aspect: Aspect, id?: string) => {
      if (id !== undefined && !has(resolvedFragmentsSlot, id)) {
        throw new FragmentLifecycleError(`"${id}" is not resolved`);
      }
      const targets = id === undefined ? undefined : withRequirements(resolvedFragmentsSlot, id);
      for (const f of ordered(resolvedFragmentsSlot)) {
        if (targets && !targets.has(f.id)) continue;
        if (!f.manifest.aspects[aspect]) continue;
        await activateOne(aspect, f);
      }
    }),
    deactivate: serial(async (aspect: Aspect, id?: string) => {
      // Dependents through the resolved set, so a chain through a fragment lacking the
      // aspect still counts; deactivateAll keeps only those active in the aspect.
      const ids = id === undefined ? undefined : withDependents(resolvedFragmentsSlot, [id]);
      await deactivateAll(aspect, ids);
    }),
    retry: serial(async (aspect: Aspect, id?: string) => {
      const failed = slots.getSnapshot(failedFragmentsSlot(aspect));
      if (id !== undefined && !failed.has(id)) {
        throw new FragmentLifecycleError(`"${id}" has not failed in the ${aspect} aspect`);
      }
      const targets = id === undefined ? new Set(failed.keys()) : new Set([id]);
      const queued = slots.getSnapshot(waitingFragmentsSlot(aspect));
      for (const f of ordered(resolvedFragmentsSlot)) {
        if (targets.has(f.id) || queued.has(f.id)) await activateOne(aspect, f);
      }
    }),
    stop: serial(async () => {
      for (const aspect of ASPECTS) await deactivateAll(aspect, undefined);
    }),
    upgrade: serial(
      async (id: string, files: FragmentFiles, upgradeOptions: UpgradeOptions = {}) => {
        const current = installed(id);
        if (!current) throw new FragmentLifecycleError(`"${id}" is not installed`);
        if (current.core) {
          throw new FragmentLifecycleError(
            `"${id}" ships with the platform and cannot be upgraded`,
          );
        }
        const next = await prepareSwap(current, files, true);
        const applied = (await readApplied(id)) ?? [];
        const pending = readMigrations(next.files, next.manifest).migrations.filter(
          (m) => !applied.includes(m.tag),
        );
        const migrate = options.migrate;
        if (pending.length > 0 && !migrate) {
          throw new FragmentLifecycleError(
            `"${id}" cannot be upgraded: this host runs no migrations, and it brings ${pending.map((m) => m.tag).join(", ")}`,
          );
        }
        const deletions = pending
          .filter((m) => (m.deleted_classes ?? []).length > 0)
          .map((m) => ({ tag: m.tag, classes: m.deleted_classes ?? [] }));
        if (deletions.length > 0 && !upgradeOptions.confirmDeletedClasses) {
          throw new FragmentDeletesClassesError(id, deletions);
        }
        await archiveStore.put(next.archive, next.files);
        await swap(current, next, async () => {
          const ran: string[] = [];
          const record = async () =>
            writeRecord(id, {
              version: next.manifest.version,
              archive: next.archive,
              enabled: has(enabledFragmentsSlot, id),
              upgrade: {
                from: { version: current.manifest.version, archive: current.archive },
                migrations: [...ran],
              },
            });
          await record();
          for (const migration of pending) {
            try {
              await hook(() => migrate?.(next, migration));
            } catch (error) {
              throw new FragmentMigrationError(id, migration.tag, error);
            }
            applied.push(migration.tag);
            ran.push(migration.tag);
            await profile.set(appliedMigrationsKey(id), applied);
            await record();
          }
        });
        return next;
      },
    ),
    rollback: serial(async (id: string) => {
      const current = installed(id);
      if (!current) throw new FragmentLifecycleError(`"${id}" is not installed`);
      const upgrade = (await readRecord(id))?.upgrade;
      if (!upgrade) {
        throw new FragmentRollbackError(id, `"${id}" has no upgrade to roll back`);
      }
      if (upgrade.migrations.length > 0) {
        throw new FragmentRollbackError(
          id,
          `"${id}" cannot be rolled back: its upgrade ran the migrations ${upgrade.migrations.join(", ")}`,
          upgrade.migrations,
        );
      }
      const files = await archiveStore.get(upgrade.from.archive);
      if (!files) {
        throw new FragmentRollbackError(
          id,
          `"${id}" cannot be rolled back: the archive ${upgrade.from.archive} is not in the store`,
        );
      }
      const next = await prepareSwap(current, files, false);
      await archiveStore.put(next.archive, next.files);
      await swap(current, next, async () => {
        await writeRecord(id, {
          version: next.manifest.version,
          archive: next.archive,
          enabled: has(enabledFragmentsSlot, id),
        });
      });
      return next;
    }),
  };
}
