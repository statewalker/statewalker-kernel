// The shell's entry: boot the platform, render the workbench in the device mode the window's
// width gives, and keep the open views in the URL (src/url-layout.ts says which layout wins).
import "@statewalker/system.workbench/theme.css";
import "@statewalker/system.workbench/client.css";
import "@statewalker/system.a2ui/client.css";
import "@statewalker/system.appearance/client.css";
import "@statewalker/system.settings/client.css";
import "@statewalker/system.profile/client.css";
import "@statewalker/system.l10n/client.css";
import "./app.css";
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
let serversReady!: () => void;
const ready = new Promise<void>((resolve) => (serversReady = resolve));
if (launch.fragments !== "browser") serversReady();
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
          ready: () => ready,
          fetch: (request) => fetch(request),
        },
      }),
});
window.platform = platform;
// In this origin, the server halves start beside the shell, not before it; the client halves'
// requests wait for them (`ready`).
if (launch.fragments === "browser") {
  void import("./fragment-servers.js")
    .then(({ startFragmentServers }) => startFragmentServers(platform.kernel, base, launch))
    .then((servers) => {
      window.fragmentServers = servers;
      serversReady();
    })
    .catch((error: unknown) =>
      console.error("[fragments] the server halves did not start:", error),
    );
}
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
