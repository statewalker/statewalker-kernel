// The fragment manager (statewalker-root#261): the model behind system.fragments' consent screen and
// manager view. React-free; the kernel does the work, the manager says what it will do and why not.
//
//   inspect(files, { source })  what the user consents to: the archive's identity and content hash,
//                               its platform range, bindings, requirements (installed, proposed
//                               from the catalog, or missing), agent plugins, secrets and command
//                               exposures, and every reason the kernel would refuse it
//   install(summary)            the archive and the proposed requirements, all or nothing, enabled
//   list()                      the app's fragments: state, failures with their error, dependents
//   enable / disable / retry / remove(id, { withData })
import {
  activeFragmentsSlot,
  archiveHash,
  type ExtensionDeclaration,
  enabledFragmentsSlot,
  type FragmentFiles,
  FragmentInstallError,
  type FragmentManifest,
  failedFragmentsSlot,
  type InstalledFragment,
  installedFragmentsSlot,
  type Kernel,
  type PlatformInfo,
  type Refusal,
  readAspectFiles,
  readManifest,
  resolvedFragmentsSlot,
} from "@statewalker/kernel.core";
import semver from "semver";

/** Where the app's installable archives come from (in apps/notes, its built `archives/`). */
export interface FragmentCatalog {
  /** The archive of `id`, or undefined when the catalog has none. */
  load(id: string): Promise<{ files: FragmentFiles; source: string } | undefined>;
  /** The ids the catalog offers, for the manager view's list of installable fragments. */
  list?(): Promise<readonly string[]>;
}

/** A requirement of the archive: met by an installed fragment, proposed from the catalog, or missing. */
export interface RequirementSummary {
  readonly id: string;
  readonly range: string;
  readonly state: "installed" | "proposed" | "missing";
  /** The installed or proposed version. */
  readonly version?: string;
  /** Where a proposed one comes from. */
  readonly source?: string;
  /** Whether an installed one is enabled (a disabled one leaves the new fragment unresolved). */
  readonly enabled?: boolean;
}

/** A command the archive contributes, with the exposures it opts in to. */
export interface ExposureSummary {
  /** `<fragment-id>/<operation-id>`. */
  readonly command: string;
  /** `agent`, `http`, `mcp`, `task`: who besides the bus may call it. */
  readonly exposures: readonly string[];
}

/** What the user consents to before an install. */
export interface ConsentSummary {
  /** The fragment, as far as its manifest reads. */
  readonly id?: string;
  readonly version?: string;
  readonly name?: string;
  readonly description?: string;
  /** Where the archive came from (a URL, a file name, the app's catalog). */
  readonly source: string;
  /** Its content hash (`archiveHash`). */
  readonly archive: string;
  readonly platform?: { readonly range: string; readonly fits: boolean };
  readonly bindings: readonly { readonly name: string; readonly offered: boolean }[];
  readonly requires: readonly RequirementSummary[];
  /** Whether it has a server half (a `wrangler.jsonc` project). */
  readonly server: boolean;
  /** What its agent aspect contributes to `agent-plugins`. */
  readonly agentPlugins: readonly Record<string, unknown>[];
  /** The secrets it declares (on a `secrets` point). */
  readonly secrets: readonly Record<string, unknown>[];
  /** Its commands exposed beyond the bus. */
  readonly exposures: readonly ExposureSummary[];
  /**
   * Every reason the kernel would refuse the install now (its own checks): this archive's, and
   * its proposed requirements'.
   */
  readonly refusals: readonly Refusal[];
  readonly installable: boolean;
  /** The archive itself, a frozen copy of the files inspected. */
  readonly files: FragmentFiles;
  /**
   * The requirements proposed from the catalog, installed with it, each after its own
   * requirements: everything the consent screen shows for them too, their refusals among
   * `refusals`. Their own `proposed` is empty.
   */
  readonly proposed: readonly ConsentSummary[];
}

/** An installed fragment, as the manager view lists it. */
export interface FragmentEntry {
  readonly id: string;
  readonly version: string;
  readonly name?: string;
  readonly enabled: boolean;
  /**
   * `active`: its aspects run; `failed`: an aspect's activation threw; `unresolved`: enabled, a
   * requirement missing or disabled; `disabled`; `installed`: enabled and resolved, nothing to run.
   */
  readonly state: "active" | "failed" | "unresolved" | "disabled" | "installed";
  readonly failures: readonly { readonly aspect: string; readonly message: string }[];
  /** The enabled fragments that require it (taken along by a cascading disable). */
  readonly dependents: readonly string[];
}

export interface FragmentManager {
  inspect(files: FragmentFiles, options: { source: string }): Promise<ConsentSummary>;
  /**
   * Install the archive and its proposed requirements, all or nothing, then enable them
   * (requirements first). Rejects with the kernel's `FragmentInstallError`, nothing installed.
   */
  install(summary: ConsentSummary): Promise<InstalledFragment[]>;
  /** The app's fragments (no core fragment), in install order. */
  list(): FragmentEntry[];
  enable(id: string): Promise<void>;
  /** Refused while enabled fragments require it, unless `cascade` (which disables them too). */
  disable(id: string, options?: { cascade?: boolean }): Promise<void>;
  /** Activate again the aspects that failed. */
  retry(id: string): Promise<void>;
  /** Keep the fragment's data, unless `withData`. */
  remove(id: string, options?: { withData?: boolean; cascade?: boolean }): Promise<void>;
  /** The catalog's fragments that are not installed: what the view offers to install. */
  available(): Promise<{ id: string; source: string; files: FragmentFiles }[]>;
  /** Called whenever `list()` may answer differently; returns the disposer. */
  observe(listener: () => void): () => void;
}

const ASPECTS = ["server", "client", "agent"] as const;

/** The extension declarations of every aspect file of an archive (unreadable ones skipped). */
function extensionsOf(
  files: FragmentFiles,
  manifest: FragmentManifest,
): { aspect: string; extension: ExtensionDeclaration }[] {
  const { aspects } = readAspectFiles(files, manifest);
  const out: { aspect: string; extension: ExtensionDeclaration }[] = [];
  for (const aspect of ASPECTS)
    for (const extension of aspects[aspect]?.extensions ?? []) out.push({ aspect, extension });
  return out;
}

/** The short name of a point (`system.profile/secrets` → `secrets`). */
const pointName = (point: string) => point.slice(point.lastIndexOf("/") + 1);

const record = (data: unknown): Record<string, unknown> =>
  data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : { value: data };

/**
 * `install` was given a summary that is not what `inspect` gives for its archives now: an archive
 * changed (or was forged) after the user consented, or the catalog offers other requirements.
 * Nothing is installed; inspect again and ask again.
 */
export class ConsentMismatchError extends Error {
  override name = "ConsentMismatchError";
}

/** The kernel's ranges: a prerelease satisfies a range it falls in. */
const RANGE = { includePrerelease: true };

export function createFragmentManager(options: {
  kernel: Kernel;
  /** The platform the kernel runs as (the same `platform` its options got): version and bindings. */
  platform: PlatformInfo;
  /** The app's installable archives, for requirements the host lacks. */
  catalog?: FragmentCatalog;
}): FragmentManager {
  const { kernel, catalog, platform } = options;
  const installed = () => kernel.slots.getSnapshot(installedFragmentsSlot);

  /** What one archive shows the user, from its own files: a frozen copy of them, and its manifest. */
  async function describe(input: FragmentFiles, source: string) {
    const files: FragmentFiles = Object.freeze({ ...input });
    const archive = await archiveHash(files);
    const read = readManifest(files);
    const base = {
      source,
      archive,
      bindings: [] as ConsentSummary["bindings"],
      server: false,
      agentPlugins: [] as ConsentSummary["agentPlugins"],
      secrets: [] as ConsentSummary["secrets"],
      exposures: [] as ConsentSummary["exposures"],
      files,
    };
    if (!read.manifest) return { draft: base, refusal: read.refusal };
    const manifest = read.manifest;
    const fits =
      manifest.engines.platform === "*" ||
      semver.satisfies(platform.version, manifest.engines.platform, RANGE);
    const offered = new Set(platform.bindings ?? []);
    const extensions = extensionsOf(files, manifest);
    const exposures: ExposureSummary[] = [];
    for (const { extension } of extensions) {
      if (pointName(extension.point) !== "commands") continue;
      const data = record(extension.data);
      const operationId = record(data.operation).operationId;
      const exposed = Object.keys(record(data.exposures ?? {}));
      if (typeof operationId === "string" && exposed.length)
        exposures.push({ command: `${manifest.id}/${operationId}`, exposures: exposed });
    }
    return {
      manifest,
      draft: {
        ...base,
        id: manifest.id,
        version: manifest.version,
        ...(manifest.name ? { name: manifest.name } : {}),
        ...(manifest.description ? { description: manifest.description } : {}),
        platform: { range: manifest.engines.platform, fits },
        bindings: (manifest.bindings ?? []).map((name) => ({ name, offered: offered.has(name) })),
        server: manifest.aspects.server !== undefined,
        agentPlugins: extensions
          .filter(({ extension }) => pointName(extension.point) === "agent-plugins")
          .map(({ extension }) => record(extension.data)),
        secrets: extensions
          .filter(({ extension }) => pointName(extension.point) === "secrets")
          .map(({ extension }) => record(extension.data)),
        exposures,
      },
    };
  }

  async function inspect(
    input: FragmentFiles,
    { source }: { source: string },
  ): Promise<ConsentSummary> {
    const root = await describe(input, source);
    if (!root.manifest)
      return {
        ...root.draft,
        requires: [],
        refusals: [root.refusal],
        installable: false,
        proposed: [],
      };

    // Requirements, in one walk: installed, else proposed from the catalog (with its own
    // requirements), else missing. Each fragment is visited once, so a cycle ends.
    type Described = Awaited<ReturnType<typeof describe>> & { manifest: FragmentManifest };
    const known = new Map<string, Described | null>([[root.manifest.id, root as Described]]);
    const requiresOf = new Map<string, RequirementSummary[]>();
    /** The proposed fragments, each after its requirements. */
    const proposed: Described[] = [];
    const enabled = kernel.slots.getSnapshot(enabledFragmentsSlot);
    const visit = async (owner: FragmentManifest) => {
      const list: RequirementSummary[] = [];
      requiresOf.set(owner.id, list);
      for (const [id, range] of Object.entries(owner.requires ?? {})) {
        const present = installed().get(id);
        if (present) {
          list.push(
            semver.satisfies(present.manifest.version, range, RANGE)
              ? {
                  id,
                  range,
                  state: "installed",
                  version: present.manifest.version,
                  enabled: enabled.has(id),
                }
              : { id, range, state: "missing", version: present.manifest.version },
          );
          continue;
        }
        if (!known.has(id)) {
          const loaded = await catalog?.load(id);
          const offered = loaded ? await describe(loaded.files, loaded.source) : undefined;
          if (offered?.manifest?.id === id) {
            known.set(id, offered as Described);
            await visit(offered.manifest);
            proposed.push(offered as Described);
          } else known.set(id, null);
        }
        const offered = known.get(id);
        if (offered && offered !== root && semver.satisfies(offered.manifest.version, range, RANGE))
          list.push({
            id,
            range,
            state: "proposed",
            version: offered.manifest.version,
            source: offered.draft.source,
          });
        else list.push({ id, range, state: "missing" });
      }
    };
    await visit(root.manifest);

    // The kernel's own checks over the batch the install would be: every reason it would refuse.
    const refusals = await kernel.check([...proposed.map((p) => p.draft.files), root.draft.files]);
    const summaryOf = (d: Described, own: readonly Refusal[]): ConsentSummary => ({
      ...d.draft,
      requires: requiresOf.get(d.manifest.id) ?? [],
      refusals: own,
      installable: own.length === 0,
      proposed: [],
    });
    return {
      ...summaryOf(root as Described, refusals),
      proposed: proposed.map((p) =>
        summaryOf(
          p,
          refusals.filter((r) => r.id === p.manifest.id),
        ),
      ),
    };
  }

  async function install(summary: ConsentSummary): Promise<InstalledFragment[]> {
    // What gets installed is what the user saw: the same archives, hashed again now.
    const fresh = await inspect(summary.files, { source: summary.source });
    const same =
      fresh.archive === summary.archive &&
      fresh.proposed.length === summary.proposed.length &&
      fresh.proposed.every((p, i) => p.archive === summary.proposed[i]?.archive);
    if (!same)
      throw new ConsentMismatchError(
        `the archives of "${summary.id ?? summary.source}" are not the ones the user consented to`,
      );
    if (!fresh.installable) throw new FragmentInstallError(fresh.refusals);
    // Requirements first, so each enable finds its requirements enabled.
    const done = await kernel.install([...fresh.proposed.map((p) => p.files), fresh.files]);
    for (const fragment of done) await kernel.enable(fragment.id);
    return done;
  }

  function list(): FragmentEntry[] {
    const enabled = kernel.slots.getSnapshot(enabledFragmentsSlot);
    const resolved = kernel.slots.getSnapshot(resolvedFragmentsSlot);
    const entries: FragmentEntry[] = [];
    for (const fragment of installed().values()) {
      if (fragment.core) continue;
      const failures: { aspect: string; message: string }[] = [];
      let active = false;
      for (const aspect of ASPECTS) {
        const failure = kernel.slots.getSnapshot(failedFragmentsSlot(aspect)).get(fragment.id);
        if (failure)
          failures.push({
            aspect,
            message: failure.error instanceof Error ? failure.error.message : String(failure.error),
          });
        if (kernel.slots.getSnapshot(activeFragmentsSlot(aspect)).has(fragment.id)) active = true;
      }
      const isEnabled = enabled.has(fragment.id);
      const state: FragmentEntry["state"] = !isEnabled
        ? "disabled"
        : failures.length
          ? "failed"
          : !resolved.has(fragment.id)
            ? "unresolved"
            : active
              ? "active"
              : "installed";
      entries.push({
        id: fragment.id,
        version: fragment.manifest.version,
        ...(fragment.manifest.name ? { name: fragment.manifest.name } : {}),
        enabled: isEnabled,
        state,
        failures,
        dependents: kernel.dependentsOf(fragment.id),
      });
    }
    return entries;
  }

  /** Only the app's fragments: a core fragment is the platform's. */
  const own = (id: string) => {
    const fragment = installed().get(id);
    if (!fragment) throw new Error(`"${id}" is not installed`);
    if (fragment.core) throw new Error(`"${id}" is a core fragment: the manager leaves it alone`);
    return fragment;
  };

  return {
    inspect,
    install,
    list,
    async enable(id) {
      own(id);
      await kernel.enable(id);
    },
    async disable(id, options) {
      own(id);
      await kernel.disable(id, options);
    },
    async retry(id) {
      own(id);
      for (const aspect of ASPECTS)
        if (kernel.slots.getSnapshot(failedFragmentsSlot(aspect)).has(id))
          await kernel.retry(aspect, id);
    },
    async remove(id, options) {
      own(id);
      await kernel.remove(id, options);
    },
    async available() {
      const ids = (await catalog?.list?.()) ?? [];
      const out: { id: string; source: string; files: FragmentFiles }[] = [];
      for (const id of ids) {
        if (installed().has(id)) continue;
        const loaded = await catalog?.load(id);
        if (loaded) out.push({ id, ...loaded });
      }
      return out;
    },
    observe(listener) {
      const stops = [
        kernel.slots.observe(installedFragmentsSlot, () => listener()),
        kernel.slots.observe(enabledFragmentsSlot, () => listener()),
        kernel.slots.observe(resolvedFragmentsSlot, () => listener()),
        ...ASPECTS.flatMap((a) => [
          kernel.slots.observe(failedFragmentsSlot(a), () => listener()),
          kernel.slots.observe(activeFragmentsSlot(a), () => listener()),
        ]),
      ];
      return () => {
        for (const stop of stops) stop();
      };
    },
  };
}
