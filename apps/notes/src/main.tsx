// The shell's entry: boot the platform, render the workbench, open the app's default layout.
import "@statewalker/system.workbench/theme.css";
import "@statewalker/system.workbench/client.css";
import "@statewalker/system.a2ui/client.css";
import "@statewalker/system.appearance/client.css";
import "./app.css";
import { createSurfaceDock } from "@statewalker/system.a2ui/client";
import { applyAppearance, BrandMark } from "@statewalker/system.appearance/client";
import { WorkbenchView } from "@statewalker/system.workbench/client";
import { createRoot } from "react-dom/client";
import { boot } from "./boot.js";

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
    <BrandMark appearance={platform.appearance} />
    <div className="app-workbench">
      <WorkbenchView workbench={platform.workbench} />
    </div>
  </div>,
);
// The application's default layout: the views it opens, once they are contributed (no layout is
// saved yet, so every run opens it).
for (const view of platform.application.layout.open) {
  if (platform.workbench.view(view)) platform.workbench.open(view);
}
