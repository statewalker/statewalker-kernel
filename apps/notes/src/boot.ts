// The shell's boot: the kernel with its core fragments (system.profile, the user's profile in
// localStorage; system.commands; system.workbench, its chrome running commands on system.commands'
// bus and keeping its layouts per device mode in the profile; system.a2ui; system.appearance;
// system.host with the browser's host services as defaults; system.settings, every fragment's
// settings in one view, the values in the profile; system.fragments, the fragment manager), the client API (commands, dialogs,
// notifications, host services, settings) and the A2UI model installed, the vault (system.profile:
// secrets encrypted in the profile, a remembered key in IndexedDB, passkeys through WebAuthn PRF)
// loaded, and the app's fragments fetched,
// installed, enabled and activated. The application definition (application.json) gives
// system.appearance its brand and the kernel its baseline fragments: installed on a fresh profile,
// restored from the profile afterwards; its default layout is the workbench's default layout for
// every device mode. React-free; main.tsx renders the result.
import { type ClientServersHost, installClient } from "@statewalker/client.core";
import {
  type ActivationContext,
  activeFragmentsSlot,
  createKernel,
  enabledFragmentsSlot,
  type FragmentFiles,
  type FragmentRecord,
  fragmentRecordKey,
  type InstalledFragment,
  installedFragmentsSlot,
  isSystemId,
  type Kernel,
  parseJsonc,
  resolvedFragmentsSlot,
} from "@statewalker/kernel.core";
import { createBrowserHostServices } from "@statewalker/platform.browser";
import {
  type A2ui,
  createSystemA2ui,
  installA2ui,
  SYSTEM_A2UI_ID,
  systemA2uiArchive,
} from "@statewalker/system.a2ui";
import {
  type Appearance,
  type BrandData,
  createSystemAppearance,
  SYSTEM_APPEARANCE_ID,
  systemAppearanceArchive,
} from "@statewalker/system.appearance";
import {
  type CommandBus,
  createSystemCommands,
  SYSTEM_COMMANDS_ID,
  systemCommandsArchive,
} from "@statewalker/system.commands";
import {
  createFragmentManager,
  type FragmentCatalog,
  type FragmentManager,
  SYSTEM_FRAGMENTS_ID,
  systemFragmentsArchive,
} from "@statewalker/system.fragments";
import {
  createSystemHost,
  SYSTEM_HOST_ID,
  type SystemHost,
  systemHostArchive,
} from "@statewalker/system.host";
import {
  createSystemL10n,
  type L10n,
  SYSTEM_L10N_ID,
  systemL10nArchive,
} from "@statewalker/system.l10n";
import {
  createIndexedDbKeyStore,
  createSystemProfile,
  createWebAuthnPasskeys,
  type ProfileStore,
  SYSTEM_PROFILE_ID,
  systemProfileArchive,
  type Vault,
} from "@statewalker/system.profile";
import {
  createSystemSettings,
  type Settings,
  SYSTEM_SETTINGS_ID,
  systemSettingsArchive,
} from "@statewalker/system.settings";
import {
  createSystemTasks,
  type QueueOperation,
  remoteQueueStore,
  SYSTEM_TASKS_ID,
  type SystemTasks,
  systemTasksArchive,
} from "@statewalker/system.tasks";
import {
  createSystemWorkbench,
  deviceModeOf,
  type LayoutContribution,
  SYSTEM_WORKBENCH_ID,
  systemWorkbenchArchive,
  type Workbench,
} from "@statewalker/system.workbench";
import application from "../application.json" with { type: "json" };
import platform from "../platform.json" with { type: "json" };
import { type AppPoints, createAppPoints } from "./app-points.js";

/** What the shell runs: also `window.platform`, for tests and the console. */
export interface Platform {
  readonly kernel: Kernel;
  readonly commands: CommandBus;
  readonly workbench: Workbench;
  readonly a2ui: A2ui;
  /** The user's profile on this device (system.profile): kernel records, layouts per mode. */
  readonly profile: ProfileStore;
  /**
   * The secrets vault (system.profile): its state is public, its secrets need an unlock. On
   * `window.platform` like the rest, for tests and the console: page code has the origin's
   * authority anyway (statewalker-root ADR 2026-11-19-code-kinds-and-trust).
   */
  readonly vault: Vault;
  readonly appearance: Appearance;
  /** system.settings: every enabled fragment's settings page, the values in the profile. */
  readonly settings: Settings;
  /** The interface language and every fragment's texts in it (system.l10n). */
  readonly l10n: L10n;
  /** system.fragments: the app's fragments installed with the user's consent, and their lifecycle. */
  readonly fragments: FragmentManager;
  /** The application definition this shell runs (application.json). */
  readonly application: ApplicationDefinition;
  /** Whether this run started from a fresh profile (and installed the baseline). */
  readonly firstRun: boolean;
  /** The kernel's lifecycle slots, for tests and the console. */
  readonly slots: {
    readonly installed: typeof installedFragmentsSlot;
    readonly enabled: typeof enabledFragmentsSlot;
    /** The fragments whose client aspect is active. */
    readonly active: ReturnType<typeof activeFragmentsSlot>;
  };
  /** system.host: the host services in effect (`services`), and who provides each. */
  readonly host: Pick<SystemHost, "services" | "provider">;
}

/**
 * An application: its brand (as system.appearance's `branding` point takes it), its baseline
 * fragments (installed on first run; disableable, not removable) and its default layout.
 */
export interface ApplicationDefinition {
  readonly id: string;
  readonly brand: BrandData;
  readonly baseline: readonly string[];
  readonly layout: { readonly open: readonly string[] };
}

/** What the profile records of the application: its first run happened. */
export interface ApplicationRecord {
  readonly baseline: readonly string[];
}

/** The profile key of the application's record: `applications/<id>`. */
export const applicationRecordKey = (id: string) => `applications/${id}`;

declare global {
  interface Window {
    platform: Platform;
  }
}

export interface BootOptions {
  /**
   * Where the app's fragment archives are served: `<base>archives/<id>/...`. (`<base>fragments/<id>/`
   * is the fragments' server halves, statewalker/statewalker-root#259.)
   */
  readonly base: URL;
  /** The interface language at start (`navigator.language`); system.l10n's default otherwise. */
  readonly locale?: string;
  /** The user's profile; localStorage under `<application id>:` by default. */
  readonly profile?: ProfileStore;
  /**
   * The fragments' server halves, as the launch configuration runs them (statewalker-root#436):
   * the client API's `servers`. None: no server halves, the client halves keep their own state.
   */
  readonly servers?: ClientServersHost;
  /**
   * "Remove with data" for a fragment's server half: its DO storage deleted where the launch
   * configuration runs it. None: server halves keep their data (a server host's own concern).
   */
  readonly removeServerData?: (id: string) => Promise<void>;
  /**
   * Settles once fragment `id`'s server half runs, rejecting with why it cannot: a fragment with
   * a server half is activated only then. None: its client half does not wait.
   */
  readonly serverHalf?: (id: string) => Promise<void>;
  /**
   * Called once the kernel has installed the app's fragments, before their client aspects are
   * activated: what runs the server halves starts here (their activations wait for it).
   */
  readonly started?: (kernel: Kernel) => void;
}

/** `load` run once, its promise shared. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let loaded: Promise<T> | undefined;
  return () => {
    loaded ??= load();
    return loaded;
  };
}

/** The folder of a fragment's aspect, relative to the page. */
function aspectUrl(base: URL, fragment: InstalledFragment, aspect: "client"): URL {
  const dir = fragment.manifest.aspects[aspect]?.dir ?? aspect;
  return new URL(`archives/${fragment.id}/${dir}/`, base);
}

async function text(url: URL): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  return response.text();
}

/** A fragment's root files, as the kernel installs them: `fragment.jsonc` and its aspect files. */
async function fetchArchive(base: URL, id: string): Promise<FragmentFiles> {
  const root = new URL(`archives/${id}/`, base);
  const manifest = await text(new URL("fragment.jsonc", root));
  const aspects = Object.keys(
    (parseJsonc(manifest).value as { aspects?: Record<string, unknown> })?.aspects ?? {},
  );
  const files: Record<string, string> = { "fragment.jsonc": manifest };
  for (const aspect of aspects) {
    const name = aspect === "server" ? "wrangler.jsonc" : `fragment.${aspect}.jsonc`;
    files[name] = await text(new URL(name, root));
  }
  return files;
}

/**
 * The client half of an app fragment: its prebuilt stylesheet (`<client dir>/index.css`) is
 * linked while the aspect is active, and the points it opens reach its code (the client API's
 * `points`). Its code loads lazily, through its extensions' references. A fragment with a server
 * half is active once that half runs (`serverHalf`): one that cannot load fails the activation,
 * with its reason, and a retry tries again.
 */
async function activateClient(
  base: URL,
  fragment: InstalledFragment,
  context: ActivationContext,
  appPoints: AppPoints,
  serverHalf?: (id: string) => Promise<void>,
): Promise<() => void> {
  if (fragment.manifest.aspects.server && serverHalf) await serverHalf(fragment.id);
  const release = appPoints.attach(fragment.id, context.extensions);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("index.css", aspectUrl(base, fragment, "client")).href;
  link.dataset.fragment = fragment.id;
  await new Promise<void>((done) => {
    link.onload = () => done();
    link.onerror = () => {
      link.remove(); // a fragment without CSS
      done();
    };
    document.head.append(link);
  });
  return () => {
    link.remove();
    release();
  };
}

/**
 * Activate the client aspect of every fragment that resolves after boot: one enabled again after
 * a disable, or installed and enabled later. Its extensions come back on resolve; activation links
 * its stylesheet. Returns the disposer.
 */
function activateWhenResolved(kernel: Kernel): () => void {
  let known = new Set(kernel.slots.getSnapshot(resolvedFragmentsSlot).keys());
  return kernel.slots.observe(resolvedFragmentsSlot, (resolved) => {
    const fresh = [...resolved.values()].filter(
      (f) => !known.has(f.id) && f.manifest.aspects.client,
    );
    known = new Set(resolved.keys());
    for (const fragment of fresh) {
      // Queued after the operation that resolved it; a fragment gone by then is refused, harmlessly.
      kernel.activate("client", fragment.id).catch((error: unknown) => {
        console.warn(`[shell] ${fragment.id} (client) not activated:`, error);
      });
    }
  });
}

/**
 * Install the application's fragments. A fresh profile (no application record) gets the
 * baseline, enabled. Otherwise the fragments the profile records are installed again, enabled
 * as recorded, with any baseline fragment it lacks (one an update of the application added);
 * a recorded fragment no longer served is skipped and its record dropped.
 * Returns whether this was the first run.
 */
async function installFragments(
  kernel: Kernel,
  profile: ProfileStore,
  base: URL,
  definition: ApplicationDefinition,
): Promise<boolean> {
  const key = applicationRecordKey(definition.id);
  const firstRun = (await profile.get(key)) === undefined;
  const recorded = firstRun
    ? []
    : profile
        .keys()
        .filter((k) => k.startsWith(fragmentRecordKey("")))
        .map((k) => k.slice(fragmentRecordKey("").length))
        // The core fragments ship with the shell; `start` installed them.
        .filter((id) => !isSystemId(id));
  const ids = [...new Set([...recorded, ...definition.baseline])];
  // The records before the installs rewrite them (installed, not enabled).
  const records = new Map<string, FragmentRecord | undefined>();
  for (const id of ids) {
    records.set(id, (await profile.get(fragmentRecordKey(id))) as FragmentRecord | undefined);
  }
  // A recorded fragment the application no longer serves is skipped and forgotten, so it cannot
  // stop every later boot; only a baseline fragment that cannot be fetched stops this one.
  const fetched = await Promise.allSettled(ids.map((id) => fetchArchive(base, id)));
  const archives: FragmentFiles[] = [];
  for (const [i, result] of fetched.entries()) {
    const id = ids[i] as string;
    if (result.status === "fulfilled") archives.push(result.value);
    else if (definition.baseline.includes(id)) throw result.reason;
    else {
      console.warn(`[shell] ${id} is no longer served; its record is dropped:`, result.reason);
      await profile.delete(fragmentRecordKey(id));
    }
  }
  for (const fragment of await kernel.install(archives)) {
    if (records.get(fragment.id)?.enabled !== false) await kernel.enable(fragment.id);
  }
  if (firstRun) {
    await profile.set(key, { baseline: definition.baseline } satisfies ApplicationRecord);
  }
  return firstRun;
}

/**
 * The application's default layout as the workbench's (the host's `layouts`, before the `layouts`
 * point's): the views it opens, in the centre, in every device mode.
 */
export function applicationLayouts(definition: ApplicationDefinition): LayoutContribution[] {
  return [{ zones: { center: [...definition.layout.open] } }];
}

/**
 * system.tasks' queue in its fragment DO, through its server half (`POST fragments/system.tasks/queue`
 * with one operation, `{ value }` or `{ error }` back).
 */
function tasksStore(servers: ClientServersHost) {
  const url = new URL(`fragments/${SYSTEM_TASKS_ID}/queue`, servers.base).href;
  return remoteQueueStore(async (operation: QueueOperation) => {
    await servers.ready();
    const response = await servers.fetch(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(operation),
      }),
    );
    const body = (await response.json().catch(() => ({}))) as { value?: unknown; error?: string };
    if (!response.ok)
      throw new Error(body.error ?? `system.tasks' server half answered ${response.status}`);
    return body.value;
  });
}

/** The app's installable archives: `archives/index.json`, each fetched as the boot fetches it. */
function archiveCatalog(base: URL): FragmentCatalog {
  return {
    async list() {
      const response = await fetch(new URL("archives/index.json", base));
      if (!response.ok) return [];
      return ((await response.json()) as { fragments?: string[] }).fragments ?? [];
    },
    async load(id) {
      try {
        return {
          files: await fetchArchive(base, id),
          source: new URL(`archives/${id}/`, base).href,
        };
      } catch {
        return undefined;
      }
    },
  };
}

export async function boot({
  base,
  locale,
  profile,
  servers,
  removeServerData,
  serverHalf,
  started,
}: BootOptions): Promise<Platform> {
  const definition: ApplicationDefinition = application;
  const system = createSystemProfile({
    ...(profile ? {} : { storage: localStorage, prefix: `${definition.id}:` }),
    vault: {
      // A key remembered on this device: non-extractable, in IndexedDB, per application.
      keys: createIndexedDbKeyStore(`${definition.id}:vault`),
      authenticator: createWebAuthnPasskeys({ rpName: definition.brand.name }),
      passkeyName: `${definition.brand.name} vault`,
    },
  });
  // Locked, unlocked by a key remembered on this device, absent, or unreadable (and left alone).
  await system.vault.load();
  const userProfile = profile ?? system.store;
  const appearance = createSystemAppearance({ brand: definition.brand });
  const commands = createSystemCommands();
  // The interface language: the browser's at start, switched live by the user.
  const l10n = createSystemL10n({ ...(locale ? { locale } : {}) });
  const workbench = createSystemWorkbench({
    commands: commands.bus,
    // Every label of the chrome is read through system.l10n, in the interface language.
    l10n: l10n.l10n,
    // The device mode of the window's width from the start: before React renders, the URL state
    // (bindLayoutToUrl) already edits, and so saves, the current mode's layout.
    mode: deviceModeOf(window.innerWidth),
    profile: userProfile,
    layouts: applicationLayouts(definition),
  });
  // Agents' surfaces ask before an event runs a command; until system.security answers, nothing
  // is approved (fail-closed).
  const a2ui = createSystemA2ui({ commands: commands.bus });
  // The browser's clipboard, file picker and URL hash, until a fragment contributes its own.
  const host = createSystemHost({ defaults: createBrowserHostServices() });
  // Every fragment's settings page, its values in the profile (`settings/<fragment-id>`).
  // Their labels in the interface language, through system.l10n.
  const settings = createSystemSettings({ profile: userProfile, l10n: l10n.l10n });
  /** Core fragments' client modules: what their own references (`./index.js`) resolve to. */
  const coreModules: Record<string, () => Promise<Record<string, unknown>>> = {
    [SYSTEM_WORKBENCH_ID]: async () => workbench.module,
    // The vault view is React: its module loads with the view, bound to the vault.
    [SYSTEM_PROFILE_ID]: once(async () => {
      const client = await import("@statewalker/system.profile/client");
      return client.vaultModule(system.vault);
    }),
    // The settings view is React: its module loads with the view, bound to the model.
    [SYSTEM_SETTINGS_ID]: once(async () => {
      const client = await import("@statewalker/system.settings/client");
      return client.settingsModule(settings.settings);
    }),
    // The manager view is React: its module loads with the view, bound to the manager.
    [SYSTEM_FRAGMENTS_ID]: once(async () => {
      const client = await import("@statewalker/system.fragments/client");
      return client.fragmentsModule(fragments);
    }),
  };
  // system.tasks, with its queue in its fragment DO: only where server halves run (with none,
  // tasks would have nowhere to wait, so the platform has no queue).
  let tasks: SystemTasks | undefined;
  /** The points app fragments open, for their client code (the client API's `points`). */
  const appPoints = createAppPoints();
  const kernel = createKernel({
    platform: { version: platform.version, bindings: [] },
    core: [
      systemProfileArchive,
      systemCommandsArchive,
      systemWorkbenchArchive,
      systemA2uiArchive,
      systemAppearanceArchive,
      systemHostArchive,
      systemSettingsArchive,
      systemL10nArchive,
      systemFragmentsArchive,
      ...(servers ? [systemTasksArchive] : []),
    ],
    profile: userProfile,
    baseline: definition.baseline,
    onError: (id, aspect, error) => console.error(`[kernel] ${id} (${aspect}):`, error),
    // "Remove with data": the fragment's settings values leave the profile. A plain removal
    // keeps them, so a reinstall finds them.
    removeData: async (fragment) => {
      settings.removeData(fragment.id);
      if (fragment.manifest.aspects.server) await removeServerData?.(fragment.id);
    },
    resolvers: {
      // A client module export, from the fragment's client folder.
      module: async (ref, { contributor }) => {
        if (contributor.id === SYSTEM_TASKS_ID && tasks)
          return tasks.module[ref.export ?? "default"];
        const core = coreModules[contributor.id];
        if (core) return (await core())[ref.export ?? "default"];
        const folder = aspectUrl(base, contributor, "client").href;
        const url = new URL(ref.module, folder).href;
        // The kernel refuses references that are not paths inside the aspect folder; the shell
        // loads nothing from anywhere else whatever reaches it (an archive is not this origin's).
        if (!url.startsWith(folder) || !url.startsWith(new URL("archives/", base).href))
          throw new Error(
            `${contributor.id}: "${ref.module}" is not a module of its client folder`,
          );
        const module = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
        return module[ref.export ?? "default"];
      },
      command: (ref) => (input: unknown) => commands.bus.call(ref.command, input),
    },
    activators: {
      client: (fragment, context) => {
        if (fragment.id === SYSTEM_PROFILE_ID) return system.activate(context);
        if (fragment.id === SYSTEM_COMMANDS_ID) return commands.activate(context);
        if (fragment.id === SYSTEM_WORKBENCH_ID) return workbench.activate(context);
        if (fragment.id === SYSTEM_A2UI_ID) return a2ui.activate(context);
        if (fragment.id === SYSTEM_APPEARANCE_ID) return appearance.activate(context);
        if (fragment.id === SYSTEM_HOST_ID) return host.activate(context);
        if (fragment.id === SYSTEM_SETTINGS_ID) return settings.activate(context);
        if (fragment.id === SYSTEM_L10N_ID) return l10n.activate(context);
        // Its view is all it brings; the stylesheet is the shell's (main.tsx).
        if (fragment.id === SYSTEM_FRAGMENTS_ID) return () => {};
        if (fragment.id === SYSTEM_TASKS_ID && tasks) return tasks.activate(context);
        return activateClient(base, fragment, context, appPoints, serverHalf);
      },
    },
  });
  installClient({
    commands: commands.bus,
    dialogs: workbench.workbench.dialogs,
    notifications: workbench.workbench.notifications,
    host: host.services,
    settings: settings.settings,
    l10n: l10n.l10n,
    ...(servers ? { servers } : {}),
    points: appPoints.points,
  });
  if (servers)
    tasks = createSystemTasks({
      commands: commands.bus,
      callAs: commands.callAs,
      slots: kernel.slots,
      store: tasksStore(servers),
      // The runners are this page's: a lease outlives a closed or reloaded page by at most 10 s,
      // then the task runs again (at least once; handlers deduplicate by the task's id).
      leaseMs: 10_000,
      onError: (error) => console.warn("[system.tasks]", error),
    });
  const fragments = createFragmentManager({
    kernel,
    platform: { version: platform.version, bindings: [] },
    catalog: archiveCatalog(base),
  });
  installA2ui(a2ui.a2ui);
  await kernel.start();

  const firstRun = await installFragments(kernel, userProfile, base, definition);
  started?.(kernel);
  await kernel.activate("client");
  activateWhenResolved(kernel);
  return {
    kernel,
    commands: commands.bus,
    workbench: workbench.workbench,
    a2ui: a2ui.a2ui,
    profile: userProfile,
    vault: system.vault,
    host: { services: host.services, provider: host.provider },
    appearance: appearance.appearance,
    settings: settings.settings,
    l10n: l10n.l10n,
    fragments,
    application: definition,
    firstRun,
    slots: {
      installed: installedFragmentsSlot,
      enabled: enabledFragmentsSlot,
      active: activeFragmentsSlot("client"),
    },
  };
}
