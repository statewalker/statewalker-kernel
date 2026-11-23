// The shell's entry: boot the platform, render the workbench, open the views the URL names (the
// app's default layout when it names none) and keep the URL in step with them.
import "@statewalker/system.workbench/theme.css";
import "@statewalker/system.workbench/client.css";
import "@statewalker/system.a2ui/client.css";
import "./app.css";
import { createSurfaceDock } from "@statewalker/system.a2ui/client";
import { WorkbenchView } from "@statewalker/system.workbench/client";
import { createRoot } from "react-dom/client";
import { boot } from "./boot.js";
import { bindLayoutToUrl } from "./url-layout.js";

/** The views the app opens at start when the URL names none, once they are contributed. */
const DEFAULT_LAYOUT = ["org.statewalker.notes/notes"];

const platform = await boot({ base: new URL(".", document.baseURI), locale: navigator.language });
window.platform = platform;
// Surfaces popped out (by the user, or by system.workbench/open-surface) show in the dock.
platform.workbench.setSurfaceSource(createSurfaceDock(platform.a2ui));
const app = document.getElementById("app");
if (!app) throw new Error("no #app element");
createRoot(app).render(<WorkbenchView workbench={platform.workbench} />);
await bindLayoutToUrl(platform.workbench, platform.host.services.urlState, DEFAULT_LAYOUT);
