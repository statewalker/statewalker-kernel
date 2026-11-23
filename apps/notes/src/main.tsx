// The shell's entry: boot the platform, render the workbench in the device mode the window's
// width gives, and keep the open views in the URL (src/url-layout.ts says which layout wins).
import "@statewalker/system.workbench/theme.css";
import "@statewalker/system.workbench/client.css";
import "@statewalker/system.a2ui/client.css";
import "@statewalker/system.appearance/client.css";
import "@statewalker/system.settings/client.css";
import "@statewalker/system.l10n/client.css";
import "./app.css";
import { createSurfaceDock } from "@statewalker/system.a2ui/client";
import { applyAppearance, BrandMark } from "@statewalker/system.appearance/client";
import { LanguagePicker } from "@statewalker/system.l10n/client";
import { WorkbenchView } from "@statewalker/system.workbench/client";
import { createRoot } from "react-dom/client";
import { boot } from "./boot.js";
import { bindLayoutToUrl } from "./url-layout.js";

const platform = await boot({ base: new URL(".", document.baseURI), locale: navigator.language });
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
