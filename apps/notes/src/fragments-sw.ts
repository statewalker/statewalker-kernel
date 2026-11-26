/// <reference lib="webworker" />
// The app's ServiceWorker for the launch configuration `browser` (statewalker/statewalker-root#259):
// CellB's router. `<scope>fragments/{id}/…` (and `<scope>peers/<self>/fragments/{id}/…`) go to the
// pool of shard workers the tabs run (src/fragment-servers.ts); every other request is left to the
// network. It answers 404 for a fragment no tab knows and 503 for a disabled one itself.
import { installProjectRouter } from "@statewalker/cellb/tabs";

declare const self: ServiceWorkerGlobalScope;
self.addEventListener("install", () => void self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
installProjectRouter(self, { basePath: new URL(".", self.location.href).pathname });
