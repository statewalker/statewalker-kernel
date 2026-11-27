// The shell's entry: boot the platform, render the workbench in the device mode the window's
// width gives, and keep the open views in the URL (src/url-layout.ts says which layout wins).
import "@statewalker/system.workbench/theme.css";
import "@statewalker/system.workbench/client.css";
import "@statewalker/system.a2ui/client.css";
import "@statewalker/system.appearance/client.css";
import "@statewalker/system.settings/client.css";
import "@statewalker/system.fragments/client.css";
import "@statewalker/system.profile/client.css";
import "@statewalker/system.l10n/client.css";
import "./app.css";
import type { Kernel } from "@statewalker/kernel.core";
import { createSurfaceDock } from "@statewalker/system.a2ui/client";
import { applyAppearance, BrandMark } from "@statewalker/system.appearance/client";
import { LanguagePicker } from "@statewalker/system.l10n/client";
import { WorkbenchView } from "@statewalker/system.workbench/client";
import { createRoot } from "react-dom/client";
import { boot } from "./boot.js";
import { readLaunchConfig } from "./fragment-servers.js";
import { bindLayoutToUrl } from "./url-layout.js";

const base = new URL(".", document.baseURI);
// The fragments' server halves, as the launch configuration says (launch.json): in this origin on
// CellB (`browser`), or by the server the page came from (`server`), or none.
const launch = await readLaunchConfig(base);
window.launch = launch;
/** The kernel, once boot has installed the app's fragments: the server halves start then. */
let kernelKnown!: (kernel: Kernel) => void;
const kernel = new Promise<Kernel>((resolve) => {
  kernelKnown = resolve;
});
/** The current attempt to start the server halves in this origin; none after a failed one. */
let attempt: Promise<void> | undefined;

/**
 * Settles once requests can reach the server halves. In this origin it starts them, once the
 * kernel is known; a start that failed is tried again by the next caller (a request, a fragment's
 * activation or its retry), not remembered.
 */
function ready(): Promise<void> {
  if (launch.fragments !== "browser") return Promise.resolve();
  attempt ??= kernel
    .then(async (k) => {
      const { startFragmentServers } = await import("./fragment-servers.js");
      window.fragmentServers = await startFragmentServers(k, base, launch);
    })
    .catch((error: unknown) => {
      attempt = undefined;
      console.error("[fragments] the server halves did not start:", error);
      throw new Error(
        `the server halves did not start: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    });
  return attempt;
}
/** How long a fragment's activation waits for its server half: then it fails, retryable. */
const SERVER_HALF_TIMEOUT = 30_000;

/** `promise`, or a rejection with `message` once `ms` have passed. */
function within<T>(ms: number, promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

const platform = await boot({
  base,
  locale: navigator.language,
  ...(launch.fragments === "none"
    ? {}
    : {
        servers: {
          base: base.href,
          // A fragment with a server aspect, while the kernel has it installed.
          available: (id) =>
            platform?.kernel.slots.getSnapshot(platform.slots.installed).get(id)?.manifest.aspects
              .server !== undefined,
          ready,
          fetch: (request) => fetch(request),
        },
        // In this origin, the server halves start once the kernel has the app's fragments,
        // before their client halves activate: a fragment is active once its server half runs,
        // failed (and retryable) when it cannot load. The DOs' storage is the shard pool's; a
        // server host keeps its own.
        ...(launch.fragments === "browser"
          ? {
              started: (k: Kernel) => {
                kernelKnown(k);
                // Started beside the shell; each activation waiting on it reports a failure.
                ready().catch(() => {});
              },
              serverHalf: (id: string) =>
                within(
                  SERVER_HALF_TIMEOUT,
                  ready().then(() => window.fragmentServers?.ensure(id)),
                  `${id}: its server half did not start within ${SERVER_HALF_TIMEOUT / 1000} s`,
                ),
              removeServerData: async (id: string) => {
                await ready();
                await window.fragmentServers?.removeData(id);
              },
            }
          : {
              // The server the page came from deletes the server half's data
              // (scripts/launch.mjs); one that cannot refuses, and the kernel keeps its record.
              removeServerData: async (id: string) => {
                const response = await fetch(
                  new URL(`_launch/fragments/${encodeURIComponent(id)}/data/remove`, base),
                  { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
                );
                if (!response.ok)
                  throw new Error(
                    `${id}: this host did not remove its data (${response.status} ${await response.text()})`,
                  );
              },
            }),
      }),
});
window.platform = platform;
// The brand's tokens, light or dark, its name and its logo, set on the page and kept set.
applyAppearance(platform.appearance);
// Surfaces popped out (by the user, or by system.workbench/open-surface) show in the dock.
platform.workbench.setSurfaceSource(createSurfaceDock(platform.a2ui));
const app = document.getElementById("app");
if (!app) throw new Error("no #app element");
createRoot(app).render(
  <div className="app-frame">
    <div className="app-top">
      <BrandMark appearance={platform.appearance} />
      {/* The interface language, switched live: the chrome and the views follow, no reload. */}
      <div className="app-language">
        <LanguagePicker l10n={platform.l10n} />
      </div>
    </div>
    <div className="app-workbench">
      <WorkbenchView workbench={platform.workbench} />
    </div>
  </div>,
);
// The views the URL state names win: they open in the current device mode's layout (and are saved
// there). Otherwise the mode's saved layout shows, else the application's default layout; the URL
// then follows the open views, and they follow it.
await bindLayoutToUrl(platform.workbench, platform.host.services.urlState);
