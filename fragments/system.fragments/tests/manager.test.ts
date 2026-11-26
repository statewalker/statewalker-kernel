// Seam 1 (statewalker-root#261): the fragment manager over the real kernel. What an archive asks
// for before the user consents, its install with the requirements a catalog offers (all or
// nothing), the refusals' reasons, and the lifecycle: failed and retried, disabled with its
// dependents listed, removed with or without data.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  archiveHash,
  createKernel,
  enabledFragmentsSlot,
  type FragmentFiles,
  installedFragmentsSlot,
  type Kernel,
  parseJsonc,
  resolvedFragmentsSlot,
} from "@statewalker/kernel.core";
import { describe, expect, it } from "vitest";
import {
  ConsentMismatchError,
  createFragmentManager,
  type FragmentCatalog,
  SYSTEM_FRAGMENTS_ID,
  systemFragmentsArchive,
} from "../src/index.js";

const SCHEMA = "https://example.org/schemas/fragment.v1.schema.json";
const ASPECT_SCHEMA = "https://example.org/schemas/fragment-aspect.v1.schema.json";

interface FragmentSpec {
  id: string;
  version?: string;
  platform?: string;
  requires?: Record<string, string>;
  bindings?: string[];
  server?: boolean;
  client?: { point: string; data: unknown }[];
  agent?: { point: string; data: unknown }[];
}

/** An archive: fragment.jsonc and the aspect files the spec asks for. */
function archive(spec: FragmentSpec): FragmentFiles {
  const aspects: Record<string, object> = {};
  const files: Record<string, string> = {};
  if (spec.server) {
    aspects.server = {};
    files["wrangler.jsonc"] = JSON.stringify({
      name: spec.id.replaceAll(".", "-"),
      main: "server/index.js",
      compatibility_date: "2025-06-01",
    });
  }
  if (spec.client) {
    aspects.client = {};
    files["fragment.client.jsonc"] = JSON.stringify({
      $schema: ASPECT_SCHEMA,
      extensions: spec.client,
    });
  }
  if (spec.agent) {
    aspects.agent = {};
    files["fragment.agent.jsonc"] = JSON.stringify({
      $schema: ASPECT_SCHEMA,
      extensions: spec.agent,
    });
  }
  files["fragment.jsonc"] = JSON.stringify({
    $schema: SCHEMA,
    id: spec.id,
    version: spec.version ?? "1.0.0",
    engines: { platform: spec.platform ?? "^1.0.0" },
    ...(spec.requires ? { requires: spec.requires } : {}),
    ...(spec.bindings ? { bindings: spec.bindings } : {}),
    aspects,
  });
  return files;
}

const NOTES = archive({ id: "org.example.notes", client: [] });
const MARKDOWN = archive({ id: "org.example.markdown", client: [] });
const EXPORT = archive({
  id: "org.example.notes-export",
  requires: { "org.example.notes": "^1.0.0", "org.example.markdown": "^1.0.0" },
  bindings: ["durable-objects"],
  server: true,
  client: [
    {
      point: "commands",
      data: {
        operation: { operationId: "export-notes", summary: "Export the notes" },
        exposures: { agent: { kind: "read" }, http: {} },
      },
    },
    { point: "commands", data: { operation: { operationId: "preview" } } },
    { point: "system.profile/secrets", data: { name: "EXPORT_TOKEN", title: "Export token" } },
  ],
  agent: [{ point: "agent-plugins", data: { name: "exporter", title: "Exporter skill" } }],
});

/** The app's catalog: archives it can install by id. */
function catalog(...archives: FragmentFiles[]): FragmentCatalog {
  const byId = new Map(
    archives.map((files) => [
      (JSON.parse(files["fragment.jsonc"] ?? "{}") as { id: string }).id,
      files,
    ]),
  );
  return {
    async load(id) {
      const files = byId.get(id);
      return files ? { files, source: `catalog:${id}` } : undefined;
    },
  };
}

interface Started {
  kernel: Kernel;
  platform: { version: string; bindings: string[] };
  removedData: string[];
  failOnce: Set<string>;
}

async function start(
  installed: FragmentFiles[] = [],
  options: { bindings?: string[] } = {},
): Promise<Started> {
  const removedData: string[] = [];
  const failOnce = new Set<string>();
  const platform = { version: "1.0.0", bindings: options.bindings ?? ["durable-objects"] };
  const kernel = createKernel({
    platform,
    removeData: (fragment) => {
      removedData.push(fragment.id);
    },
    activators: {
      client: (fragment) => {
        if (failOnce.delete(fragment.id)) throw new Error(`${fragment.id} failed to start`);
      },
    },
  });
  await kernel.start();
  if (installed.length) {
    const done = await kernel.install(installed);
    for (const f of done) await kernel.enable(f.id);
    await kernel.activate("client");
  }
  return { kernel, platform, removedData, failOnce };
}

describe("the system.fragments fragment", () => {
  it("ships the archive its folder holds", () => {
    const root = join(import.meta.dirname, "..");
    const onDisk = parseJsonc(readFileSync(join(root, "fragment.jsonc"), "utf8")).value;
    expect(onDisk).toEqual(JSON.parse(systemFragmentsArchive["fragment.jsonc"] ?? "null"));
    const client = parseJsonc(readFileSync(join(root, "fragment.client.jsonc"), "utf8")).value;
    expect(client).toEqual(JSON.parse(systemFragmentsArchive["fragment.client.jsonc"] ?? "null"));
    expect(SYSTEM_FRAGMENTS_ID).toBe("system.fragments");
  });
});

describe("inspect: what the user consents to", () => {
  it("lists source, hash, bindings, requirements, agent plugins, secrets and exposures", async () => {
    const { kernel, platform } = await start([NOTES]);
    const manager = createFragmentManager({ kernel, platform, catalog: catalog(MARKDOWN) });
    const summary = await manager.inspect(EXPORT, { source: "https://example.org/export.zip" });
    expect(summary).toMatchObject({
      id: "org.example.notes-export",
      version: "1.0.0",
      source: "https://example.org/export.zip",
      archive: await archiveHash(EXPORT),
      platform: { range: "^1.0.0", fits: true },
      bindings: [{ name: "durable-objects", offered: true }],
      server: true,
      agentPlugins: [{ name: "exporter", title: "Exporter skill" }],
      secrets: [{ name: "EXPORT_TOKEN", title: "Export token" }],
      exposures: [
        { command: "org.example.notes-export/export-notes", exposures: ["agent", "http"] },
      ],
      refusals: [],
      installable: true,
    });
    expect(summary.requires).toEqual([
      {
        id: "org.example.notes",
        range: "^1.0.0",
        state: "installed",
        version: "1.0.0",
        enabled: true,
      },
      {
        id: "org.example.markdown",
        range: "^1.0.0",
        state: "proposed",
        version: "1.0.0",
        source: "catalog:org.example.markdown",
      },
    ]);
    // Consent to inspect changes nothing.
    expect(kernel.slots.getSnapshot(installedFragmentsSlot).has("org.example.notes-export")).toBe(
      false,
    );
  });

  it("refuses with the reasons: an unmet requirement, the platform, a binding", async () => {
    const { kernel, platform } = await start([NOTES], { bindings: [] });
    const manager = createFragmentManager({ kernel, platform, catalog: catalog() });
    const summary = await manager.inspect(
      archive({
        id: "org.example.future",
        platform: "^2.0.0",
        requires: { "org.example.nowhere": "^1.0.0" },
        bindings: ["vectors"],
        client: [],
      }),
      { source: "file" },
    );
    expect(summary.installable).toBe(false);
    expect(summary.refusals.map((r) => r.code).sort()).toEqual([
      "incompatible-platform",
      "missing-binding",
      "unmet-requirement",
    ]);
    expect(summary.refusals.find((r) => r.code === "unmet-requirement")?.message).toContain(
      "org.example.nowhere",
    );
    await expect(manager.install(summary)).rejects.toMatchObject({
      refusals: expect.arrayContaining([
        expect.objectContaining({ code: "incompatible-platform" }),
      ]),
    });
    expect(kernel.slots.getSnapshot(installedFragmentsSlot).has("org.example.future")).toBe(false);
  });

  it("refuses an archive whose manifest does not read, with the kernel's reason", async () => {
    const { kernel, platform } = await start();
    const manager = createFragmentManager({ kernel, platform });
    const summary = await manager.inspect({ "fragment.jsonc": "{ nope" }, { source: "file" });
    expect(summary.installable).toBe(false);
    expect(summary.refusals[0]?.code).toBe("invalid-manifest");
  });
});

describe("install: all or nothing, with the proposed requirements", () => {
  it("installs and enables the archive with the requirements the catalog offers", async () => {
    const { kernel, platform } = await start([NOTES]);
    const manager = createFragmentManager({ kernel, platform, catalog: catalog(MARKDOWN) });
    const summary = await manager.inspect(EXPORT, { source: "file" });
    const installed = await manager.install(summary);
    expect(installed.map((f) => f.id).sort()).toEqual([
      "org.example.markdown",
      "org.example.notes-export",
    ]);
    const resolved = kernel.slots.getSnapshot(resolvedFragmentsSlot);
    expect(resolved.has("org.example.notes-export")).toBe(true);
    expect(resolved.has("org.example.markdown")).toBe(true);
  });

  it("installs nothing when one of them is refused", async () => {
    const { kernel, platform } = await start([NOTES]);
    // The catalog's markdown needs a platform this host is not.
    const manager = createFragmentManager({
      kernel,
      platform,
      catalog: catalog(archive({ id: "org.example.markdown", platform: "^9.0.0", client: [] })),
    });
    const summary = await manager.inspect(EXPORT, { source: "file" });
    expect(summary.installable).toBe(false);
    expect(summary.refusals[0]).toMatchObject({
      id: "org.example.markdown",
      code: "incompatible-platform",
    });
    await expect(manager.install(summary)).rejects.toThrow();
    const installed = kernel.slots.getSnapshot(installedFragmentsSlot);
    expect(installed.has("org.example.notes-export")).toBe(false);
    expect(installed.has("org.example.markdown")).toBe(false);
  });
});

describe("the installed fragments and their lifecycle", () => {
  it("lists the app's fragments with their state, failed ones with the error, and retries", async () => {
    const { kernel, platform, failOnce } = await start([NOTES]);
    const manager = createFragmentManager({ kernel, platform, catalog: catalog(MARKDOWN) });
    failOnce.add("org.example.notes-export");
    await manager.install(await manager.inspect(EXPORT, { source: "file" }));
    await kernel.activate("client");
    const listed = manager.list();
    expect(listed.map((f) => f.id)).toEqual([
      "org.example.notes",
      "org.example.markdown",
      "org.example.notes-export",
    ]);
    const failed = listed.find((f) => f.id === "org.example.notes-export");
    expect(failed).toMatchObject({ state: "failed", enabled: true });
    expect(failed?.failures[0]).toMatchObject({
      aspect: "client",
      message: "org.example.notes-export failed to start",
    });
    expect(listed.find((f) => f.id === "org.example.notes")).toMatchObject({ state: "active" });
    await manager.retry("org.example.notes-export");
    expect(manager.list().find((f) => f.id === "org.example.notes-export")).toMatchObject({
      state: "active",
      failures: [],
    });
  });

  it("lists the dependents a disable would take along, and unresolves them only with cascade", async () => {
    const { kernel, platform } = await start([NOTES]);
    const manager = createFragmentManager({ kernel, platform, catalog: catalog(MARKDOWN) });
    await manager.install(await manager.inspect(EXPORT, { source: "file" }));
    expect(manager.list().find((f) => f.id === "org.example.notes")?.dependents).toEqual([
      "org.example.notes-export",
    ]);
    await expect(manager.disable("org.example.notes")).rejects.toThrow();
    expect(kernel.slots.getSnapshot(enabledFragmentsSlot).has("org.example.notes")).toBe(true);
    await manager.disable("org.example.notes", { cascade: true });
    expect(kernel.slots.getSnapshot(enabledFragmentsSlot).has("org.example.notes")).toBe(false);
    // The kernel's cascade: the dependent stays enabled, unresolved while its requirement is off.
    expect(manager.list().find((f) => f.id === "org.example.notes")?.state).toBe("disabled");
    expect(manager.list().find((f) => f.id === "org.example.notes-export")?.state).toBe(
      "unresolved",
    );
    await manager.enable("org.example.notes");
    expect(kernel.slots.getSnapshot(resolvedFragmentsSlot).has("org.example.notes-export")).toBe(
      true,
    );
  });

  it("removes keeping the data, or with it", async () => {
    const { kernel, platform, removedData } = await start([NOTES]);
    const manager = createFragmentManager({ kernel, platform, catalog: catalog(MARKDOWN) });
    await manager.install(await manager.inspect(EXPORT, { source: "file" }));
    await manager.remove("org.example.notes-export");
    expect(removedData).toEqual([]);
    await manager.install(await manager.inspect(EXPORT, { source: "file" }));
    await manager.remove("org.example.notes-export", { withData: true });
    expect(removedData).toEqual(["org.example.notes-export"]);
    expect(kernel.slots.getSnapshot(installedFragmentsSlot).has("org.example.notes-export")).toBe(
      false,
    );
  });

  it("lists no core fragment, and refuses to manage one", async () => {
    const platform = { version: "1.0.0", bindings: [] };
    const kernel = createKernel({ platform, core: [systemFragmentsArchive] });
    await kernel.start();
    await kernel.install([NOTES]);
    const manager = createFragmentManager({ kernel, platform });
    expect(kernel.slots.getSnapshot(installedFragmentsSlot).has(SYSTEM_FRAGMENTS_ID)).toBe(true);
    expect(manager.list().map((f) => f.id)).toEqual(["org.example.notes"]);
    for (const act of [
      () => manager.enable(SYSTEM_FRAGMENTS_ID),
      () => manager.disable(SYSTEM_FRAGMENTS_ID),
      () => manager.retry(SYSTEM_FRAGMENTS_ID),
      () => manager.remove(SYSTEM_FRAGMENTS_ID),
    ])
      await expect(act()).rejects.toThrow(/core fragment/);
    expect(kernel.slots.getSnapshot(enabledFragmentsSlot).has(SYSTEM_FRAGMENTS_ID)).toBe(true);
  });

  it("removes keeping the data: a reinstall finds it, its migrations recorded", async () => {
    const journal = (tags: string[]) => ({
      ...archive({ id: "org.example.journal", server: true }),
      "wrangler.jsonc": JSON.stringify({
        name: "org-example-journal",
        main: "server/index.js",
        migrations: tags.map((tag) => ({ tag, new_sqlite_classes: ["Journal"] })),
      }),
    });
    const { kernel, platform } = await start();
    const manager = createFragmentManager({ kernel, platform });
    await manager.install(await manager.inspect(journal(["v1"]), { source: "file" }));
    await manager.remove("org.example.journal");
    // The kept data: an archive bringing a migration it lacks would change it, so is refused.
    const newer = await manager.inspect(journal(["v1", "v2"]), { source: "file" });
    expect(newer.refusals.map((r) => r.code)).toEqual(["pending-migrations"]);
    const again = await manager.inspect(journal(["v1"]), { source: "file" });
    expect((await manager.install(again)).map((f) => f.id)).toEqual(["org.example.journal"]);
  });
});

describe("review regressions (statewalker/statewalker-kernel#71)", () => {
  it("installs only the archives the user consented to", async () => {
    const { kernel, platform } = await start([NOTES]);
    const manager = createFragmentManager({ kernel, platform, catalog: catalog(MARKDOWN) });
    const files: Record<string, string> = { ...EXPORT };
    const summary = await manager.inspect(files, { source: "file" });
    // The caller's object changes after consent: the summary keeps what was inspected.
    files["fragment.jsonc"] = (files["fragment.jsonc"] ?? "").replace("1.0.0", "6.6.6");
    expect(Object.isFrozen(summary.files)).toBe(true);
    const done = await manager.install(summary);
    expect(done.find((f) => f.id === "org.example.notes-export")?.manifest.version).toBe("1.0.0");
  });

  it("refuses a summary whose archives are not the ones inspected", async () => {
    const { kernel, platform } = await start([NOTES]);
    const offered = { current: MARKDOWN };
    const manager = createFragmentManager({
      kernel,
      platform,
      catalog: {
        load: async (id) =>
          id === "org.example.markdown" ? { files: offered.current, source: "catalog" } : undefined,
      },
    });
    const summary = await manager.inspect(EXPORT, { source: "file" });
    const forged = { ...summary, files: archive({ id: "org.example.other" }) };
    await expect(manager.install(forged)).rejects.toBeInstanceOf(ConsentMismatchError);
    // The catalog now offers another markdown than the one shown.
    offered.current = archive({ id: "org.example.markdown", version: "1.1.0", client: [] });
    await expect(manager.install(summary)).rejects.toBeInstanceOf(ConsentMismatchError);
    const installed = kernel.slots.getSnapshot(installedFragmentsSlot);
    expect(installed.has("org.example.notes-export")).toBe(false);
    expect(installed.has("org.example.markdown")).toBe(false);
  });

  it("shows a proposed requirement's own items", async () => {
    const markdown = archive({
      id: "org.example.markdown",
      server: true,
      client: [
        { point: "system.profile/secrets", data: { name: "MD_TOKEN" } },
        {
          point: "commands",
          data: { operation: { operationId: "render" }, exposures: { http: {} } },
        },
      ],
      agent: [{ point: "agent-plugins", data: { name: "md" } }],
    });
    const { kernel, platform } = await start([NOTES]);
    const manager = createFragmentManager({ kernel, platform, catalog: catalog(markdown) });
    const summary = await manager.inspect(EXPORT, { source: "file" });
    expect(summary.proposed).toHaveLength(1);
    expect(summary.proposed[0]).toMatchObject({
      id: "org.example.markdown",
      archive: await archiveHash(markdown),
      source: "catalog:org.example.markdown",
      server: true,
      secrets: [{ name: "MD_TOKEN" }],
      agentPlugins: [{ name: "md" }],
      exposures: [{ command: "org.example.markdown/render", exposures: ["http"] }],
      installable: true,
    });
  });

  it("gives every reason the kernel would refuse, and accepts what it accepts", async () => {
    const { kernel, platform } = await start([
      archive({ id: "org.example.d", version: "1.1.0-beta.1" }),
    ]);
    const manager = createFragmentManager({ kernel, platform });
    const reserved = await manager.inspect(archive({ id: "system.evil" }), { source: "file" });
    expect(reserved).toMatchObject({ installable: false });
    expect(reserved.refusals.map((r) => r.code)).toEqual(["reserved-id"]);
    const noWrangler = { ...archive({ id: "org.example.srv", server: true }) };
    delete (noWrangler as Record<string, string>)["wrangler.jsonc"];
    expect((await manager.inspect(noWrangler, { source: "file" })).refusals[0]?.code).toBe(
      "worker-name",
    );
    // A prerelease in range satisfies it, as the kernel reads ranges.
    const pre = await manager.inspect(
      archive({ id: "org.example.e", requires: { "org.example.d": "^1.0.0" } }),
      { source: "file" },
    );
    expect(pre.installable).toBe(true);
    await manager.install(pre);
  });

  it("installs nothing when the kernel refuses a requirement the catalog proposes", async () => {
    const { kernel, platform } = await start([NOTES]);
    // The catalog offers a markdown with a server half whose Worker is misnamed.
    const bad = {
      ...archive({ id: "org.example.markdown", server: true, client: [] }),
      "wrangler.jsonc": JSON.stringify({ name: "elsewhere", main: "x.js" }),
    };
    const manager = createFragmentManager({ kernel, platform, catalog: catalog(bad) });
    const summary = await manager.inspect(EXPORT, { source: "file" });
    expect(summary.installable).toBe(false);
    expect(summary.proposed[0]?.refusals.map((r) => r.code)).toEqual(["worker-name"]);
    // Even forced through (its `installable` set), the kernel installs nothing.
    await expect(manager.install({ ...summary, installable: true })).rejects.toMatchObject({
      refusals: [expect.objectContaining({ code: "worker-name" })],
    });
    const installed = kernel.slots.getSnapshot(installedFragmentsSlot);
    expect(installed.has("org.example.markdown")).toBe(false);
    expect(installed.has("org.example.notes-export")).toBe(false);
  });

  it("ends on requirements that require each other", async () => {
    const b = archive({ id: "org.example.b", requires: { "org.example.c": "^1.0.0" } });
    const c = archive({ id: "org.example.c", requires: { "org.example.b": "^1.0.0" } });
    let loads = 0;
    const offered = catalog(b, c);
    const { kernel, platform } = await start();
    const manager = createFragmentManager({
      kernel,
      platform,
      catalog: {
        load: (id) => {
          loads++;
          return offered.load(id);
        },
      },
    });
    const summary = await manager.inspect(
      archive({ id: "org.example.a", requires: { "org.example.b": "^1.0.0" } }),
      { source: "file" },
    );
    expect(summary.proposed.map((p) => p.id)).toEqual(["org.example.c", "org.example.b"]);
    expect(summary.proposed.find((p) => p.id === "org.example.c")?.requires[0]?.state).toBe(
      "proposed",
    );
    expect(loads).toBe(2);
  });
});

describe("the manager view's model", () => {
  it("offers the catalog's fragments not installed, and tells observers of every change", async () => {
    const { kernel, platform, failOnce } = await start([NOTES]);
    const offered = catalog(NOTES, MARKDOWN);
    const manager = createFragmentManager({
      kernel,
      platform,
      catalog: { ...offered, list: async () => ["org.example.notes", "org.example.markdown"] },
    });
    expect((await manager.available()).map((a) => a.id)).toEqual(["org.example.markdown"]);
    let changes = 0;
    const stop = manager.observe(() => changes++);
    failOnce.add("org.example.markdown");
    await manager.install(await manager.inspect(MARKDOWN, { source: "file" }));
    await kernel.activate("client");
    expect(changes).toBeGreaterThan(0);
    expect(await manager.available()).toEqual([]);
    const seen = changes;
    stop();
    await manager.disable("org.example.markdown");
    expect(changes).toBe(seen);
  });
});
