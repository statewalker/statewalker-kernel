// Node vitest (no ServiceWorker, injected fake host) for the open-command logic — task 5.3a
// / webapp-dock-view R1 "Command opens a tab". Dispatching `OpenWebAppCommand` hosts the
// project via the injected boundary and fires `ShowDockPanelCommand` with a spec that
// references the hosted `baseUrl` (and resolved client entry). The real SW hosting path is a
// browser E2E (5.3b, group 6) and is deliberately not exercised here.

import { SpecStore } from "@statewalker/render.core";
import { Commands } from "@statewalker/shared-commands";
import { ShowDockPanelCommand } from "@statewalker/shell.core";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { type Project, Workspace } from "@statewalker/workspace.core";
import { describe, expect, it } from "vitest";
import { WEBAPP_DOCK_CATALOG_ID, webAppPanelId, webAppSpecId } from "../src/dock-catalog.js";
import { OpenWebAppCommand, registerOpenWebApp } from "../src/open-web-app.js";

const enc = new TextEncoder();

const WEBAPP_FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "hello" }),
  "client/index.html": "<!doctype html>",
  "server/index.ts": "export default async () => new Response('ok');",
};

async function setupProject(root = "proj"): Promise<{ project: Project; workspace: Workspace }> {
  const fs = new MemFilesApi();
  for (const [path, body] of Object.entries(WEBAPP_FILES)) {
    await fs.write(`/${root}/${path}`, [enc.encode(body)]);
  }
  const workspace = new Workspace().setFileSystem(fs);
  const project = await workspace.getProject(root, true);
  if (!project) throw new Error("project not resolved");
  return { project, workspace };
}

describe("registerOpenWebApp (open-command logic, injected host)", () => {
  it("hosts via the injected boundary and fires ShowDockPanelCommand with a spec referencing the baseUrl", async () => {
    const { project, workspace } = await setupProject();
    const commands = workspace.requireAdapter(Commands);
    const store = workspace.requireAdapter(SpecStore);

    const BASE_URL = "http://site.local/abcd/";
    let hosted: Project | undefined;
    const host = async (p: Project) => {
      hosted = p;
      return { baseUrl: BASE_URL, stop: async () => {} };
    };

    // Capture ShowDockPanelCommand instead of wiring the real (React) dock fragment.
    const shown: Array<{ panelId: string; specId: string }> = [];
    commands.listen(ShowDockPanelCommand, (cmd) => {
      shown.push({ panelId: cmd.payload.panelId, specId: cmd.payload.specId });
      cmd.resolve();
      return true;
    });

    registerOpenWebApp({ commands, store, host });
    await commands.call(OpenWebAppCommand, { project }).promise;

    // The injected boundary was invoked with the project.
    expect(hosted).toBe(project);

    // A single dock panel was requested with the deterministic (path-keyed) ids.
    const specId = webAppSpecId(project.path);
    expect(shown).toEqual([{ panelId: webAppPanelId(project.path), specId }]);

    // The stored spec references the hosted baseUrl + resolved client entry.
    const record = store.get(specId);
    expect(record?.catalogId).toBe(WEBAPP_DOCK_CATALOG_ID);
    const props = (record?.spec as { elements: { site: { props: SiteFrameProps } } }).elements.site
      .props;
    expect(props.baseUrl).toBe(BASE_URL);
    // Stored as a baseUrl-relative URL including the hosted `~/` project-file prefix.
    expect(props.clientEntry).toBe("~/client/index.html");
  });

  it("re-dispatch (open-or-focus) reuses the mount: hosts exactly once, no new spec/baseUrl", async () => {
    const { project, workspace } = await setupProject();
    const commands = workspace.requireAdapter(Commands);
    const store = workspace.requireAdapter(SpecStore);

    // Each host() call would be a fresh SW mount with a distinct baseUrl — B1's leak is a
    // second mount on re-dispatch. Count invocations and hand back a changing baseUrl so a
    // spurious re-host would be observable in the stored spec.
    let hostCalls = 0;
    const host = async (_p: Project) => {
      hostCalls += 1;
      return { baseUrl: `http://site.local/mount-${hostCalls}/`, stop: async () => {} };
    };

    const shown: Array<{ panelId: string; specId: string }> = [];
    commands.listen(ShowDockPanelCommand, (cmd) => {
      shown.push({ panelId: cmd.payload.panelId, specId: cmd.payload.specId });
      cmd.resolve();
      return true;
    });

    registerOpenWebApp({ commands, store, host });
    await commands.call(OpenWebAppCommand, { project }).promise;
    await commands.call(OpenWebAppCommand, { project }).promise;

    // The injected host was called exactly once — the second dispatch mounts no new SW site.
    expect(hostCalls).toBe(1);

    // Both dispatches request the same panel (open-or-focus focuses the existing tab).
    const specId = webAppSpecId(project.path);
    const panelId = webAppPanelId(project.path);
    expect(shown).toEqual([
      { panelId, specId },
      { panelId, specId },
    ]);

    // The persistent spec still points at the FIRST mount's baseUrl (not re-created).
    const props = (store.get(specId)?.spec as { elements: { site: { props: SiteFrameProps } } })
      .elements.site.props;
    expect(props.baseUrl).toBe("http://site.local/mount-1/");
  });

  it("concurrent re-dispatch (both before the first host() resolves) still hosts exactly once", async () => {
    const { project, workspace } = await setupProject();
    const commands = workspace.requireAdapter(Commands);
    const store = workspace.requireAdapter(SpecStore);

    // A host() that stays pending until we release it: both dispatches arrive while the first
    // mount is still in flight, so a check→await→set map would double-mount. Only the in-flight
    // reservation prevents the second host() call.
    let hostCalls = 0;
    let releaseHost: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseHost = resolve;
    });
    const host = async (_p: Project) => {
      hostCalls += 1;
      await gate;
      return { baseUrl: `http://site.local/mount-${hostCalls}/`, stop: async () => {} };
    };

    commands.listen(ShowDockPanelCommand, (cmd) => {
      cmd.resolve();
      return true;
    });

    registerOpenWebApp({ commands, store, host });
    // Fire twice WITHOUT awaiting the first — both reach the handler before host() resolves.
    const p1 = commands.call(OpenWebAppCommand, { project }).promise;
    const p2 = commands.call(OpenWebAppCommand, { project }).promise;
    releaseHost?.();
    await Promise.all([p1, p2]);

    // The concurrent second dispatch reused the in-flight mount — host() ran exactly once.
    expect(hostCalls).toBe(1);
    // A single spec exists, pointing at the one-and-only mount.
    const specId = webAppSpecId(project.path);
    const props = (store.get(specId)?.spec as { elements: { site: { props: SiteFrameProps } } })
      .elements.site.props;
    expect(props.baseUrl).toBe("http://site.local/mount-1/");
  });

  it("keys panels on the project path, so two projects sharing a leaf name get distinct panels", async () => {
    const fs = new MemFilesApi();
    for (const root of ["a/hello", "b/hello"]) {
      for (const [path, body] of Object.entries(WEBAPP_FILES)) {
        await fs.write(`/${root}/${path}`, [enc.encode(body)]);
      }
    }
    const workspace = new Workspace().setFileSystem(fs);
    const projectA = await workspace.getProject("a/hello", true);
    const projectB = await workspace.getProject("b/hello", true);
    if (!projectA || !projectB) throw new Error("projects not resolved");

    // Same leaf directory name...
    expect(projectA.projectName).toBe(projectB.projectName);
    // ...but distinct paths → distinct panel/spec ids (no cross-project collision).
    expect(webAppPanelId(projectA.path)).not.toBe(webAppPanelId(projectB.path));
    expect(webAppSpecId(projectA.path)).not.toBe(webAppSpecId(projectB.path));

    const commands = workspace.requireAdapter(Commands);
    const store = workspace.requireAdapter(SpecStore);
    const host = async (_p: Project) => ({ baseUrl: "http://site.local/x/", stop: async () => {} });

    const shown: Array<{ panelId: string; specId: string }> = [];
    commands.listen(ShowDockPanelCommand, (cmd) => {
      shown.push({ panelId: cmd.payload.panelId, specId: cmd.payload.specId });
      cmd.resolve();
      return true;
    });

    registerOpenWebApp({ commands, store, host });
    await commands.call(OpenWebAppCommand, { project: projectA }).promise;
    await commands.call(OpenWebAppCommand, { project: projectB }).promise;

    expect(shown).toEqual([
      { panelId: webAppPanelId(projectA.path), specId: webAppSpecId(projectA.path) },
      { panelId: webAppPanelId(projectB.path), specId: webAppSpecId(projectB.path) },
    ]);
  });
});

interface SiteFrameProps {
  baseUrl: string;
  clientEntry: string;
}
