// Task 4.3 — browser E2E for `hostApp` over a REAL ServiceWorker.
//
// DEFERRED: this file is NOT part of the hermetic default vitest run (its `.e2e.ts`
// suffix does not match vitest's `*.test.ts` include glob). It executes in Wave 4
// (group 6) via `webapp-testing`/Playwright once the group-6 shell harness page
// exists (tasks 6.2/6.3). It requires a real browser + ServiceWorker and cannot run
// in node — do not enable it in the default suite.
//
// Covers the webapp-browser-host spec scenarios that need a ServiceWorker:
//   - "App mounted and reachable": hostApp(project) → baseUrl; a request to
//     `baseUrl + "~/" + clientEntry` served through the SW returns the transpiled
//     client document, and the response carries the COEP/CORP headers (R2 end-to-end).
//   - "Stop tears down the mount": after stop(), baseUrl no longer serves the app.
//
// Pseudocode of the harness assertion (runs in-page under Playwright):
//
//   const { baseUrl, stop } = await hostApp(project, { serviceWorkerUrl });
//   const res = await fetch(baseUrl + "~/client/index.html");
//   assert(res.status === 200 && (await res.text()).includes("<!doctype html>"));
//   assert(res.headers.get("Cross-Origin-Embedder-Policy") === "credentialless");
//   assert(res.headers.get("Cross-Origin-Resource-Policy") === "cross-origin");
//   await stop();
//   const after = await fetch(baseUrl + "~/client/index.html");
//   assert(after.status >= 400 || after.type === "error"); // no longer served

export {};
