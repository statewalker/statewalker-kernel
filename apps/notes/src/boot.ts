// The shell's boot: the kernel with its core fragments (system.profile, the user's profile in
// localStorage; system.commands; system.workbench, its chrome running commands on system.commands'
// bus and keeping its layouts per device mode in the profile; system.a2ui; system.appearance), the
// client API (commands,
// dialogs, notifications) and the A2UI model installed, and the app's fragments fetched,
// installed, enabled and activated. The application definition (application.json) gives
// system.appearance its brand and the kernel its baseline fragments: installed on a fresh profile,
// restored from the profile afterwards; its default layout is the workbench's default layout for
// every device mode. React-free; main.tsx renders the result.
import { installClient } from "@statewalker/client.core";
import {
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
  createSystemProfile,
  type ProfileStore,
  SYSTEM_PROFILE_ID,
  systemProfileArchive,
} from "@statewalker/system.profile";
import {
  createSystemWorkbench,
  type LayoutContribution,
  SYSTEM_WORKBENCH_ID,
  systemWorkbenchArchive,
  type Workbench,
} from "@statewalker/system.workbench";
import application from "../application.json" with { type: "json" };
import platform from "../platform.json" with { type: "json" };

/** What the shell runs: also `window.platform`, for tests and the console. */
export interface Platform {
  readonly kernel: Kernel;
  readonly commands: CommandBus;
  readonly workbench: Workbench;
  readonly a2ui: A2ui;
  /** The user's profile on this device (system.profile): kernel records, layouts per mode. */
  readonly profile: ProfileStore;
  readonly appearance: Appearance;
  /** The application definition this shell runs (application.json). */
  readonly application: ApplicationDefinition;
  /** Whether this run started from a fresh profile (and installed the baseline). */
  readonly firstRun: boolean;
  /** The kernel's lifecycle slots, for tests and the console. */
  readonly slots: {
    readonly installed: typeof installedFragmentsSlot;
    readonly enabled: typeof enabledFragmentsSlot;
  };
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
  /** Where the app's fragments are served: `<base>fragments/<id>/...`. */
  readonly base: URL;
  /** The locale commands are titled in (`fr-FR`); their default labels otherwise. */
  readonly locale?: string;
  /** The user's profile; localStorage under `<application id>:` by default. */
  readonly profile?: ProfileStore;
}

/** The folder of a fragment's aspect, relative to the page. */
function aspectUrl(base: URL, fragment: InstalledFragment, aspect: "client"): URL {
  const dir = fragment.manifest.aspects[aspect]?.dir ?? aspect;
  return new URL(`fragments/${fragment.id}/${dir}/`, base);
}

async function text(url: URL): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  return response.text();
}

/** A fragment's root files, as the kernel installs them: `fragment.jsonc` and its aspect files. */
async function fetchArchive(base: URL, id: string): Promise<FragmentFiles> {
  const root = new URL(`fragments/${id}/`, base);
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
 * linked while the aspect is active. Its code loads lazily, through its extensions' references.
 */
async function activateClient(base: URL, fragment: InstalledFragment): Promise<() => void> {
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
  return () => link.remove();
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

export async function boot({ base, locale, profile }: BootOptions): Promise<Platform> {
  const definition: ApplicationDefinition = application;
  const system = createSystemProfile(
    profile ? {} : { storage: localStorage, prefix: `${definition.id}:` },
  );
  const userProfile = profile ?? system.store;
  const appearance = createSystemAppearance({ brand: definition.brand });
  const commands = createSystemCommands();
  const workbench = createSystemWorkbench({
    commands: commands.bus,
    locale,
    profile: userProfile,
    layouts: applicationLayouts(definition),
  });
  // Agents' surfaces ask before an event runs a command; until system.security answers, nothing
  // is approved (fail-closed).
  const a2ui = createSystemA2ui({ commands: commands.bus });
  /** Core fragments' client modules: what their own references (`./index.js`) resolve to. */
  const coreModules: Record<string, Record<string, unknown>> = {
    [SYSTEM_WORKBENCH_ID]: workbench.module,
  };
  const kernel = createKernel({
    platform: { version: platform.version, bindings: [] },
    core: [
      systemProfileArchive,
      systemCommandsArchive,
      systemWorkbenchArchive,
      systemA2uiArchive,
      systemAppearanceArchive,
    ],
    profile: userProfile,
    baseline: definition.baseline,
    onError: (id, aspect, error) => console.error(`[kernel] ${id} (${aspect}):`, error),
    resolvers: {
      // A client module export, from the fragment's client folder.
      module: async (ref, { contributor }) => {
        const core = coreModules[contributor.id];
        if (core) return core[ref.export ?? "default"];
        const url = new URL(ref.module, aspectUrl(base, contributor, "client")).href;
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
        return activateClient(base, fragment);
      },
    },
  });
  installClient({
    commands: commands.bus,
    dialogs: workbench.workbench.dialogs,
    notifications: workbench.workbench.notifications,
  });
  installA2ui(a2ui.a2ui);
  await kernel.start();

  const firstRun = await installFragments(kernel, userProfile, base, definition);
  await kernel.activate("client");
  activateWhenResolved(kernel);
  return {
    kernel,
    commands: commands.bus,
    workbench: workbench.workbench,
    a2ui: a2ui.a2ui,
    profile: userProfile,
    appearance: appearance.appearance,
    application: definition,
    firstRun,
    slots: { installed: installedFragmentsSlot, enabled: enabledFragmentsSlot },
  };
}
