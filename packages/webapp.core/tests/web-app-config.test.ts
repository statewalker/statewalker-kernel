import { writeText } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_API_MOUNT,
  DEFAULT_CLIENT_ENTRY,
  DEFAULT_SERVER_ENTRY,
  DEFAULT_WATCH_INTERVAL_MS,
  NATURE_CONFIG_PATH,
  resolveWebAppConfig,
} from "../src/web-app-config.js";

describe("resolveWebAppConfig", () => {
  it("detects a convention-only project with default entries", async () => {
    const files = new MemFilesApi();
    await writeText(files, "/package.json", JSON.stringify({ name: "hello", dependencies: {} }));
    await writeText(files, "/client/index.html", "<!doctype html>");
    await writeText(files, "/server/index.ts", "export default () => new Response('ok');");

    const { isWebApp, config } = await resolveWebAppConfig(files);

    expect(isWebApp).toBe(true);
    expect(config).toEqual({
      clientEntry: DEFAULT_CLIENT_ENTRY,
      serverEntry: DEFAULT_SERVER_ENTRY,
      apiMount: DEFAULT_API_MOUNT,
      watchInterval: DEFAULT_WATCH_INTERVAL_MS,
    });
  });

  it("lets nature.webapp.json override the entries, mount, and interval", async () => {
    const files = new MemFilesApi();
    await writeText(files, "/package.json", JSON.stringify({ name: "hello" }));
    await writeText(files, "/app/index.html", "<!doctype html>");
    await writeText(files, "/api/main.ts", "export default () => new Response('ok');");
    await writeText(
      files,
      `/${NATURE_CONFIG_PATH}`,
      JSON.stringify({
        clientEntry: "app/index.html",
        serverEntry: "api/main.ts",
        apiMount: "/rpc",
        watchInterval: 5000,
      }),
    );

    const { isWebApp, config } = await resolveWebAppConfig(files);

    expect(isWebApp).toBe(true);
    expect(config).toEqual({
      clientEntry: "app/index.html",
      serverEntry: "api/main.ts",
      apiMount: "/rpc",
      watchInterval: 5000,
    });
  });

  it("does not treat a project with no server entry and no override as a web-app", async () => {
    const files = new MemFilesApi();
    await writeText(files, "/package.json", JSON.stringify({ name: "not-an-app" }));
    await writeText(files, "/client/index.html", "<!doctype html>");
    // no server/index.ts, no nature.webapp.json

    const { isWebApp, config } = await resolveWebAppConfig(files);

    expect(isWebApp).toBe(false);
    // effective config still falls back to the defaults
    expect(config.serverEntry).toBe(DEFAULT_SERVER_ENTRY);
  });
});
