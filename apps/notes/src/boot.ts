// The shell's boot: the kernel with its core fragments (system.commands, system.workbench, its
// chrome running commands on system.commands' bus, system.a2ui, system.host with the browser's
// host services as defaults), the client API (commands, dialogs, notifications, host services)
// and the A2UI model installed, and the app's fragments fetched,
// installed, enabled and activated. React-free; main.tsx renders the result.
import { installClient } from "@statewalker/client.core";
import {
  createKernel,
  type FragmentFiles,
  type InstalledFragment,
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
  type CommandBus,
  createSystemCommands,
  SYSTEM_COMMANDS_ID,
  systemCommandsArchive,
} from "@statewalker/system.commands";
import {
  createSystemHost,
  SYSTEM_HOST_ID,
  type SystemHost,
  systemHostArchive,
} from "@statewalker/system.host";
import {
  createSystemWorkbench,
  SYSTEM_WORKBENCH_ID,
  systemWorkbenchArchive,
  type Workbench,
} from "@statewalker/system.workbench";
import platform from "../platform.json" with { type: "json" };

/** What the shell runs: also `window.platform`, for tests and the console. */
export interface Platform {
  readonly kernel: Kernel;
  readonly commands: CommandBus;
  readonly workbench: Workbench;
  readonly a2ui: A2ui;
  /** system.host: the host services in effect (`services`), and who provides each. */
  readonly host: Pick<SystemHost, "services" | "provider">;
}

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

export async function boot({ base, locale }: BootOptions): Promise<Platform> {
  const commands = createSystemCommands();
  const workbench = createSystemWorkbench({ commands: commands.bus, locale });
  // Agents' surfaces ask before an event runs a command; until system.security answers, nothing
  // is approved (fail-closed).
  const a2ui = createSystemA2ui({ commands: commands.bus });
  // The browser's clipboard, file picker and URL hash, until a fragment contributes its own.
  const host = createSystemHost({ defaults: createBrowserHostServices() });
  /** Core fragments' client modules: what their own references (`./index.js`) resolve to. */
  const coreModules: Record<string, Record<string, unknown>> = {
    [SYSTEM_WORKBENCH_ID]: workbench.module,
  };
  const kernel = createKernel({
    platform: { version: platform.version, bindings: [] },
    core: [systemCommandsArchive, systemWorkbenchArchive, systemA2uiArchive, systemHostArchive],
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
        if (fragment.id === SYSTEM_COMMANDS_ID) return commands.activate(context);
        if (fragment.id === SYSTEM_WORKBENCH_ID) return workbench.activate(context);
        if (fragment.id === SYSTEM_A2UI_ID) return a2ui.activate(context);
        if (fragment.id === SYSTEM_HOST_ID) return host.activate(context);
        return activateClient(base, fragment);
      },
    },
  });
  installClient({
    commands: commands.bus,
    dialogs: workbench.workbench.dialogs,
    notifications: workbench.workbench.notifications,
    host: host.services,
  });
  installA2ui(a2ui.a2ui);
  await kernel.start();

  const index = JSON.parse(await text(new URL("fragments/index.json", base))) as {
    fragments: string[];
  };
  const archives = await Promise.all(index.fragments.map((id) => fetchArchive(base, id)));
  for (const fragment of await kernel.install(archives)) await kernel.enable(fragment.id);
  await kernel.activate("client");
  activateWhenResolved(kernel);
  return {
    kernel,
    commands: commands.bus,
    workbench: workbench.workbench,
    a2ui: a2ui.a2ui,
    host: { services: host.services, provider: host.provider },
  };
}
