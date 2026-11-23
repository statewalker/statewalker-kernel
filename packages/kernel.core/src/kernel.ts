import { Slots } from "@statewalker/shared-slots";
import semver from "semver";
import { FragmentInstallError, FragmentLifecycleError, type Refusal } from "./errors.js";
import { isFragmentId, isSystemId, MAX_WORKER_NAME_LENGTH, workerNameOf } from "./ids.js";
import {
  ASPECTS,
  type Aspect,
  type FragmentFiles,
  type FragmentManifest,
  type InstalledFragment,
} from "./manifest.js";
import { orderNodes } from "./order.js";
import { parseJsonc, readManifest } from "./parse-manifest.js";
import {
  activeFragmentsSlot,
  enabledFragmentsSlot,
  installedFragmentsSlot,
  resolvedFragmentsSlot,
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
  // biome-ignore lint/suspicious/noConfusingVoidType: lets activators without a `return` type-check.
) => AspectCleanup | undefined | void | Promise<AspectCleanup | undefined | void>;

export interface KernelOptions {
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
   * Activate `aspect` of fragment `id` (and first of the fragments it requires), or of
   * every resolved fragment, in dependency order.
   */
  activate(aspect: Aspect, id?: string): Promise<void>;
  /**
   * Deactivate `aspect` of fragment `id` (and first of the fragments requiring it), or
   * of every fragment, in reverse activation order.
   */
  deactivate(aspect: Aspect, id?: string): Promise<void>;
  /** Deactivate every aspect of every fragment, in reverse activation order. */
  stop(): Promise<void>;
}

// Every operation runs after the ones called before it. One called while an activator or a
// cleanup runs (from inside it, or from anywhere else at that moment) is rejected at once
// with a FragmentLifecycleError instead of waiting: an activator awaiting the kernel would
// otherwise wait for itself.

const RANGE_OPTIONS = { includePrerelease: true };

export function createKernel(options: KernelOptions): Kernel {
  const slots = options.slots ?? new Slots();
  const memberships = new Map<string, () => void>();

  const cleanups = new Map<string, AspectCleanup>();
  const onError =
    options.onError ??
    ((id: string, aspect: Aspect, error: unknown) =>
      console.error(`[kernel] "${id}" (${aspect}):`, error));

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
    const blocked = [...withRequirements(resolvedFragmentsSlot, f.id)].some(
      (dep) =>
        dep !== f.id && installed(dep)?.manifest.aspects[aspect] !== undefined && !has(slot, dep),
    );
    if (blocked) return;
    try {
      const cleanup = await hook(() => options.activators?.[aspect]?.(f));
      if (typeof cleanup === "function") cleanups.set(`${aspect}\u0000${f.id}`, cleanup);
    } catch (error) {
      onError(f.id, aspect, error);
      return;
    }
    join(slot, f);
    activeOrder.get(aspect)?.push(f.id);
  }

  async function deactivateAll(aspect: Aspect, ids: ReadonlySet<string> | undefined) {
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
    }
  }

  function installed(id: string): InstalledFragment | undefined {
    return slots.get(installedFragmentsSlot, id) ?? undefined;
  }

  /** Refusals of installing `entries` together, beside what is already installed. */
  function checkInstall(
    entries: readonly { manifest: FragmentManifest; files: FragmentFiles }[],
    core: boolean,
  ): Refusal[] {
    const refusals: Refusal[] = [];
    const batch = new Map<string, FragmentManifest>();
    const workerNames = new Map<string, string>();
    for (const f of slots.getSnapshot(installedFragmentsSlot).values()) {
      if (f.manifest.aspects.server) workerNames.set(workerNameOf(f.id), f.id);
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
      if (installed(m.id) || batch.has(m.id)) {
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
    const read: { manifest: FragmentManifest; files: FragmentFiles }[] = [];
    for (const files of archives) {
      const { manifest, refusal } = readManifest(files);
      if (refusal) refusals.push(refusal);
      else read.push({ manifest, files });
    }
    refusals.push(...checkInstall(read, core));
    if (refusals.length > 0) throw new FragmentInstallError(refusals);
    const result = read.map(({ manifest, files }) =>
      Object.freeze({ id: manifest.id, manifest, files, core }),
    );
    for (const fragment of result) join(installedFragmentsSlot, fragment);
    return result;
  }

  async function enable(id: string) {
    const fragment = installed(id);
    if (!fragment) throw new FragmentLifecycleError(`"${id}" is not installed`);
    join(enabledFragmentsSlot, fragment);
    resolve();
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

  return {
    slots,
    start: serial(async () => {
      const core = await install(options.core ?? [], true);
      for (const fragment of core) await enable(fragment.id);
    }),
    install: serial((archives: readonly FragmentFiles[]) => install(archives, false)),
    enable: serial(enable),
    disable: serial(async (id: string, { cascade = false }: { cascade?: boolean } = {}) => {
      if (!has(enabledFragmentsSlot, id)) return;
      const affected = withDependents(resolvedFragmentsSlot, [id]);
      const dependents = [...affected].filter((d) => d !== id);
      if (dependents.length > 0 && !cascade) {
        throw new FragmentLifecycleError(
          `"${id}" is required by ${dependents.map((d) => `"${d}"`).join(", ")}; confirm the cascade to disable it`,
        );
      }
      for (const aspect of ASPECTS) await deactivateAll(aspect, affected);
      leave(enabledFragmentsSlot, id);
      resolve();
    }),
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
    stop: serial(async () => {
      for (const aspect of ASPECTS) await deactivateAll(aspect, undefined);
    }),
  };
}
