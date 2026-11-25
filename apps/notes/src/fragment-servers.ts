// The server halves of the app's fragments in the browser (statewalker/statewalker-root#259): the
// launch configuration `browser` (launch.json) runs them on CellB in this origin. A ServiceWorker
// (`fragments-sw.js`, CellB's router) routes `/fragments/{id}/…` to a pool of shard workers shared by
// the tabs (`fragment-shard.js`), each holding every fragment's project, and each request reaches
// the fragment's DO at `idFromName(<id>)`.
//
// The pool follows the kernel: a fragment with a server aspect is loaded while the kernel has it
// resolved, kept known as disabled (the router answers 503, without waking a DO) while it is
// installed but not resolved, and dropped (404) once it is removed.
import { type FragmentTabs, joinFragmentShards } from "@statewalker/cellb/tabs";
import {
  type InstalledFragment,
  installedFragmentsSlot,
  type Kernel,
  parseJsonc,
  resolvedFragmentsSlot,
} from "@statewalker/kernel.core";

declare global {
  interface Window {
    /** The launch configuration the page runs (launch.json). */
    launch: LaunchConfig;
    /** The server halves in this origin, once started (launch configuration `browser`). */
    fragmentServers?: FragmentServers;
  }
}

/** Where the app's fragments are served from, as launch.json says. */
export interface LaunchConfig {
  /**
   * Who serves `/fragments/{id}/…`: `browser` (CellB in this origin: a ServiceWorker and a pool of
   * shard workers), `server` (the server the page came from: CellB on Node, or `wrangler dev`
   * behind it), or `none` (no server halves).
   */
  readonly fragments: "browser" | "server" | "none";
  /** The pool's shard workers (browser), default 2. */
  readonly shards?: number;
  /** This origin's own peer id: `/peers/<peerId>/fragments/…` answers as `/fragments/…`. */
  readonly peerId?: string;
}

/** launch.json, or `none` when the page has none. */
export async function readLaunchConfig(base: URL): Promise<LaunchConfig> {
  const response = await fetch(new URL("launch.json", base));
  if (!response.ok) return { fragments: "none" };
  return (await response.json()) as LaunchConfig;
}

export interface FragmentServers {
  readonly pool: FragmentTabs;
  /** Settles once the pool has followed the kernel's latest change. */
  settled(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Starts the server halves in this origin: registers the router ServiceWorker, joins the shard
 * pool and keeps it in step with the kernel's fragments.
 */
export async function startFragmentServers(
  kernel: Kernel,
  base: URL,
  launch: LaunchConfig,
): Promise<FragmentServers> {
  // The ServiceWorker's scope is the app's folder: its pages, and `fragments/…` below it.
  const registration = await navigator.serviceWorker.register(new URL("fragments-sw.js", base), {
    type: "module",
    scope: base.pathname,
  });
  const serviceWorker = async (): Promise<ServiceWorker> => {
    await navigator.serviceWorker.ready;
    const worker = registration.active ?? registration.waiting ?? registration.installing;
    if (!worker) throw new Error("the fragments ServiceWorker did not start");
    return worker;
  };
  const pool = await joinFragmentShards({
    shards: launch.shards ?? 2,
    basePath: base.pathname,
    spawn: () => new Worker(new URL("fragment-shard.js", base), { type: "module" }),
    serviceWorker,
    ...(launch.peerId ? { peerId: launch.peerId } : {}),
  });

  /** A fragment's server half as a shard loads it: its wrangler.jsonc and its built bundle. */
  const archives = new Map<string, Promise<{ config: object; code: { bundle: string } }>>();
  const archiveOf = (fragment: InstalledFragment) => {
    let archive = archives.get(fragment.archive);
    if (!archive) {
      const root = new URL(`archives/${fragment.id}/`, base);
      const dir = fragment.manifest.aspects.server?.dir ?? "server";
      archive = (async () => {
        const bundle = await fetch(new URL(`${dir}/bundle.js`, root));
        if (!bundle.ok) throw new Error(`${fragment.id}: no server bundle (${bundle.status})`);
        const wrangler = fragment.files["wrangler.jsonc"];
        if (wrangler === undefined) throw new Error(`${fragment.id}: no wrangler.jsonc`);
        return {
          config: parseJsonc(wrangler).value as object,
          code: { bundle: await bundle.text() },
        };
      })();
      archives.set(fragment.archive, archive);
    }
    return archive;
  };

  /** One pass: the pool made to match the kernel's fragments with a server aspect. */
  const sync = async () => {
    const installed = kernel.slots.getSnapshot(installedFragmentsSlot);
    const resolved = kernel.slots.getSnapshot(resolvedFragmentsSlot);
    for (const id of pool.ids()) if (!installed.has(id)) await pool.remove(id);
    for (const fragment of installed.values()) {
      if (!fragment.manifest.aspects.server) continue;
      const want = resolved.has(fragment.id) ? "enabled" : "disabled";
      const state = pool.state(fragment.id);
      if (state === want) continue;
      if (state === undefined) {
        await pool.add(fragment.id, await archiveOf(fragment));
        if (want === "disabled") await pool.disable(fragment.id);
      } else if (want === "disabled") await pool.disable(fragment.id);
      else await pool.enable(fragment.id);
    }
  };
  // Passes run one after another; a change during one runs another after it.
  let queue: Promise<void> = Promise.resolve();
  const schedule = () => {
    queue = queue.then(sync).catch((error: unknown) => {
      console.error("[fragments] the server halves did not follow the kernel:", error);
    });
    return queue;
  };
  const stopInstalled = kernel.slots.observe(installedFragmentsSlot, () => void schedule());
  const stopResolved = kernel.slots.observe(resolvedFragmentsSlot, () => void schedule());
  await schedule();
  return {
    pool,
    settled: () => queue,
    async close() {
      stopInstalled();
      stopResolved();
      await queue;
      await pool.close();
    },
  };
}
