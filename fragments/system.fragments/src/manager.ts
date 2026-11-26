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
  /** Every reason the install would be refused: this archive's, and its proposed requirements'. */
  readonly refusals: readonly Refusal[];
  readonly installable: boolean;
  /** The archive itself, and the proposed requirements' archives, as `install` takes them. */
  readonly files: FragmentFiles;
  readonly proposed: readonly { readonly id: string; readonly files: FragmentFiles }[];
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
  remove(id: string, options?: { withData?: boolean }): Promise<void>;
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

export function createFragmentManager(options: {
  kernel: Kernel;
  /** The platform the kernel runs as (the same `platform` its options got): version and bindings. */
  platform: PlatformInfo;
  /** The app's installable archives, for requirements the host lacks. */
  catalog?: FragmentCatalog;
}): FragmentManager {
  const { kernel, catalog, platform } = options;
  const installed = () => kernel.slots.getSnapshot(installedFragmentsSlot);

  async function inspect(
    files: FragmentFiles,
    { source }: { source: string },
  ): Promise<ConsentSummary> {
    const archive = await archiveHash(files);
    const read = readManifest(files);
    const empty = {
      source,
      archive,
      bindings: [],
      requires: [],
      server: false,
      agentPlugins: [],
      secrets: [],
      exposures: [],
      files,
      proposed: [],
    };
    if (!read.manifest) return { ...empty, refusals: [read.refusal], installable: false };
    const manifest = read.manifest;
    const refusals: Refusal[] = [];
    const fits =
      semver.satisfies(platform.version, manifest.engines.platform, { includePrerelease: true }) ||
      manifest.engines.platform === "*";
    if (!fits)
      refusals.push({
        id: manifest.id,
        code: "incompatible-platform",
        message: `"${manifest.id}" needs the platform ${manifest.engines.platform}; this one is ${platform.version}`,
      });
    const offered = new Set(platform.bindings ?? []);
    const bindings = (manifest.bindings ?? []).map((name) => ({
      name,
      offered: offered.has(name),
    }));
    for (const b of bindings)
      if (!b.offered)
        refusals.push({
          id: manifest.id,
          code: "missing-binding",
          message: `"${manifest.id}" needs the binding "${b.name}", which this host does not offer`,
        });

    // Requirements: installed, else proposed from the catalog (and its own requirements), else missing.
    const requires: RequirementSummary[] = [];
    const proposed: { id: string; files: FragmentFiles }[] = [];
    const seen = new Set([manifest.id]);
    const visit = async (owner: FragmentManifest) => {
      for (const [id, range] of Object.entries(owner.requires ?? {})) {
        if (seen.has(id)) continue;
        seen.add(id);
        const present = installed().get(id);
        if (present && semver.satisfies(present.manifest.version, range)) {
          requires.push({ id, range, state: "installed", version: present.manifest.version });
          continue;
        }
        const offeredArchive = present ? undefined : await catalog?.load(id);
        const offeredManifest = offeredArchive && readManifest(offeredArchive.files).manifest;
        if (offeredArchive && offeredManifest && semver.satisfies(offeredManifest.version, range)) {
          requires.push({
            id,
            range,
            state: "proposed",
            version: offeredManifest.version,
            source: offeredArchive.source,
          });
          proposed.push({ id, files: offeredArchive.files });
          // A proposed fragment's own reasons count too: all or nothing.
          const nested = await inspect(offeredArchive.files, { source: offeredArchive.source });
          refusals.push(...nested.refusals.filter((r) => r.code !== "unmet-requirement"));
          await visit(offeredManifest);
          continue;
        }
        requires.push({
          id,
          range,
          state: "missing",
          ...(present ? { version: present.manifest.version } : {}),
        });
        refusals.push({
          id: owner.id,
          code: "unmet-requirement",
          message: present
            ? `"${owner.id}" requires "${id}" ${range}; ${present.manifest.version} is installed`
            : `"${owner.id}" requires "${id}" ${range}, which is not installed and not offered`,
        });
      }
    };
    await visit(manifest);

    if (installed().has(manifest.id))
      refusals.push({
        id: manifest.id,
        code: "already-installed",
        message: `"${manifest.id}" is already installed`,
      });

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
      ...empty,
      id: manifest.id,
      version: manifest.version,
      ...(manifest.name ? { name: manifest.name } : {}),
      ...(manifest.description ? { description: manifest.description } : {}),
      platform: { range: manifest.engines.platform, fits },
      bindings,
      requires,
      server: manifest.aspects.server !== undefined,
      agentPlugins: extensions
        .filter(({ extension }) => pointName(extension.point) === "agent-plugins")
        .map(({ extension }) => record(extension.data)),
      secrets: extensions
        .filter(({ extension }) => pointName(extension.point) === "secrets")
        .map(({ extension }) => record(extension.data)),
      exposures,
      refusals,
      installable: refusals.length === 0,
      proposed,
    };
  }

  async function install(summary: ConsentSummary): Promise<InstalledFragment[]> {
    if (!summary.installable) throw new FragmentInstallError(summary.refusals);
    // Requirements first, so each enable finds its requirements enabled.
    const done = await kernel.install([...summary.proposed.map((p) => p.files), summary.files]);
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
  };
}
