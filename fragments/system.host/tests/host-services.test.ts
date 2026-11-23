// Seam 1: the real kernel with system.host as a core fragment; observed through the host services
// (the host-services point's owner) and the kernel's public slots.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostServices, UrlState } from "@statewalker/client.core";
import {
  activeFragmentsSlot,
  createKernel,
  type ExtensionRefusal,
  extensionRefusalsSlot,
  type Kernel,
  parseJsonc,
} from "@statewalker/kernel.core";
import { describe, expect, it, vi } from "vitest";
import {
  createSystemHost,
  HostServiceError,
  SYSTEM_HOST_ID,
  systemHostArchive,
} from "../src/index.js";

const PASTE = "org.example.paste";
const CLIP = "org.example.clip";
const ROUTER = "org.example.router";
const SCHEMA = "https://example.org/schemas/fragment.v1.schema.json";
const ASPECT_SCHEMA = "https://example.org/schemas/fragment-aspect.v1.schema.json";

/** A client-only fragment contributing these host services, each a module export named after it. */
function fragment(id: string, services: Record<string, unknown>[]): Record<string, string> {
  return {
    "fragment.jsonc": JSON.stringify({
      $schema: SCHEMA,
      id,
      version: "1.0.0",
      engines: { platform: "^1.0.0" },
      aspects: { client: {} },
    }),
    "fragment.client.jsonc": JSON.stringify({
      $schema: ASPECT_SCHEMA,
      extensions: services.map((data) => ({
        point: "host-services",
        data,
        reference: { module: "./index.js", export: String(data.service) },
      })),
    }),
  };
}

/** A clipboard keeping what is written to it, under `name`. */
function clipboard(name: string, log: string[]) {
  let text = "";
  return {
    async writeText(value: string) {
      log.push(`${name}: ${value}`);
      text = value;
    },
    readText: async () => text,
  };
}

/** A URL state in memory, telling its observers of each write. */
function urlState(initial: UrlState) {
  let state = initial;
  const listeners = new Set<(state: UrlState) => void>();
  return {
    read: async () => state,
    async write(next: UrlState) {
      state = next;
      for (const listener of [...listeners]) listener(next);
    },
    observe(listener: (state: UrlState) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

/**
 * The kernel with system.host as its core fragment, the host's `defaults`, and these fragments
 * enabled and active; `modules` holds each fragment's client module (what its references name).
 */
async function platform(
  archives: Record<string, string>[],
  modules: Record<string, Record<string, unknown>>,
  defaults: Partial<HostServices> = {},
) {
  const system = createSystemHost({ defaults });
  const kernel = createKernel({
    platform: { version: "1.0.0", bindings: [] },
    core: [systemHostArchive],
    resolvers: {
      module: (ref, { contributor }) => modules[contributor.id]?.[ref.export ?? "default"],
    },
    activators: {
      client: (f, context) => (f.id === SYSTEM_HOST_ID ? system.activate(context) : undefined),
    },
  });
  await kernel.start();
  for (const f of await kernel.install(archives)) await kernel.enable(f.id);
  await kernel.activate("client");
  return { kernel, host: system.services, provider: system.provider };
}

function refusals(kernel: Kernel): ExtensionRefusal[] {
  return [...kernel.slots.getSnapshot(extensionRefusalsSlot("client")).values()];
}

describe("the system.host fragment", () => {
  it("is a core fragment the kernel installs and activates", async () => {
    const { kernel } = await platform([], {});
    expect([...kernel.slots.getSnapshot(activeFragmentsSlot("client")).keys()]).toEqual([
      SYSTEM_HOST_ID,
    ]);
  });

  it("ships the archive its folder holds", () => {
    const root = join(import.meta.dirname, "..");
    for (const file of ["fragment.jsonc", "fragment.client.jsonc"]) {
      const onDisk = parseJsonc(readFileSync(join(root, file), "utf8")).value;
      expect(onDisk).toEqual(JSON.parse(systemHostArchive[file] ?? "null"));
    }
  });
});

describe("the host-services point", () => {
  it("answers with the host's own services while no fragment contributes one", async () => {
    const log: string[] = [];
    const { host, provider } = await platform([], {}, { clipboard: clipboard("host", log) });
    await host.clipboard.writeText("Buy milk");
    await expect(host.clipboard.readText()).resolves.toBe("Buy milk");
    expect(log).toEqual(["host: Buy milk"]);
    expect(provider("clipboard")).toBeUndefined();
    // A service the host does not have, and nobody contributes, is unavailable.
    const refused = host.files.pickFile();
    await expect(refused).rejects.toBeInstanceOf(HostServiceError);
    await expect(refused).rejects.toMatchObject({ kind: "unavailable", service: "files" });
  });

  it("replaces the host's service with a fragment's, which goes away with the fragment", async () => {
    const log: string[] = [];
    const { kernel, host, provider } = await platform(
      [fragment(CLIP, [{ service: "clipboard" }])],
      { [CLIP]: { clipboard: clipboard("clip", log) } },
      { clipboard: clipboard("host", log) },
    );
    expect(provider("clipboard")).toBe(CLIP);
    await host.clipboard.writeText("one");

    await kernel.disable(CLIP);
    expect(provider("clipboard")).toBeUndefined();
    await host.clipboard.writeText("two");

    await kernel.enable(CLIP);
    expect(provider("clipboard")).toBe(CLIP);
    await host.clipboard.writeText("three");
    expect(log).toEqual(["clip: one", "host: two", "clip: three"]);
  });

  it("keeps the first fragment's service, the next taking over when it leaves", async () => {
    const log: string[] = [];
    const { kernel, host, provider } = await platform(
      [fragment(CLIP, [{ service: "clipboard" }]), fragment(PASTE, [{ service: "clipboard" }])],
      {
        [CLIP]: { clipboard: clipboard("clip", log) },
        [PASTE]: { clipboard: clipboard("paste", log) },
      },
    );
    expect(provider("clipboard")).toBe(CLIP);
    await host.clipboard.writeText("one");
    await kernel.disable(CLIP);
    expect(provider("clipboard")).toBe(PASTE);
    await host.clipboard.writeText("two");
    expect(log).toEqual(["clip: one", "paste: two"]);
  });

  it("moves URL-state observers to the service in effect", async () => {
    const fromHost = urlState({ path: "", query: {} });
    const fromRouter = urlState({ path: "/router", query: {} });
    const { kernel, host } = await platform(
      [fragment(ROUTER, [{ service: "url-state" }])],
      { [ROUTER]: { "url-state": fromRouter } },
      { urlState: fromHost },
    );
    await kernel.disable(ROUTER);
    const seen: string[] = [];
    host.urlState.observe((state) => seen.push(state.path));
    await host.urlState.write({ path: "/a", query: {} });

    await kernel.enable(ROUTER);
    await expect(host.urlState.read()).resolves.toEqual({ path: "/router", query: {} });
    await vi.waitFor(async () => {
      await fromRouter.write({ path: "/b", query: {} });
      expect(seen).toContain("/b");
    });
    // The host's own URL state no longer reaches the observers.
    await fromHost.write({ path: "/ignored", query: {} });
    await kernel.disable(ROUTER);
    await vi.waitFor(async () => {
      await fromHost.write({ path: "/c", query: {} });
      expect(seen).toContain("/c");
    });
    expect(seen).not.toContain("/ignored");
  });

  it("refuses a contribution naming no known service, with a reason", async () => {
    const log: string[] = [];
    const { kernel, provider } = await platform(
      [fragment(CLIP, [{ service: "camera" }, { service: "clipboard", extra: true }])],
      { [CLIP]: { clipboard: clipboard("clip", log) } },
    );
    expect(provider("clipboard")).toBeUndefined();
    const refused = refusals(kernel);
    expect(refused).toHaveLength(2);
    for (const r of refused) {
      expect(r).toMatchObject({ contributor: CLIP, point: "host-services", code: "invalid-data" });
    }
  });

  it("refuses a contributed service that lacks the method called", async () => {
    const { host } = await platform([fragment(CLIP, [{ service: "clipboard" }])], {
      [CLIP]: { clipboard: { readText: async () => "" } },
    });
    await expect(host.clipboard.writeText("x")).rejects.toMatchObject({
      kind: "invalid-service",
      service: "clipboard",
    });
  });
});
