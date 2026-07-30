import { writeText } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it } from "vitest";
import { buildSiteHandler, WebAppNature } from "../src/web-app-nature.js";
import serverHandler from "./fixtures/server-entry.js";
import { setupProject } from "./util/web-app-fixture.js";

describe("buildSiteHandler", () => {
  it("serves the client entry through the warm module server (no ServiceWorker)", async () => {
    const { project } = await setupProject();
    await new WebAppNature(project).scan(); // warm the persistent cache

    let baseUrl = "";
    const handler = await buildSiteHandler(project, { getBaseUrl: () => baseUrl });
    baseUrl = "http://host/";

    const response = await handler(new Request("http://host/~/client/index.html"));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<!doctype html>");
  });

  it("routes /api/* to the server runner, distinct from /* to the module server", async () => {
    const { project } = await setupProject();
    await new WebAppNature(project).scan();

    const handler = await buildSiteHandler(project, { getBaseUrl: () => "http://host/" });

    // `/~/...` is served by the warm module server.
    expect((await handler(new Request("http://host/~/client/index.html"))).status).toBe(200);

    // `/api/...` reaches the runner endpoint, NOT the module server (which would 404):
    // the runner can't dynamic-import an http server-entry URL in node, so it yields a
    // 500. A swapped registration order (`/*` before `/api/*`) would 404 here instead.
    expect((await handler(new Request("http://host/api/anything"))).status).toBe(500);
  });

  it("the built server module receives its context via env and returns its response", async () => {
    // Direct server-module invocation (D4): proves the `(request, env)` contract and
    // that the module reads its persistent context from the injected `env`.
    const data = new MemFilesApi();
    await writeText(data, "/message.txt", "hello-from-env");

    const response = await serverHandler(new Request("http://host/api/msg"), { data });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("hello-from-env");
  });
});
