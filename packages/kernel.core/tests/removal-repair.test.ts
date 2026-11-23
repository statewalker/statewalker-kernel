import { describe, expect, it } from "vitest";
import {
  type ActivationContext,
  type Aspect,
  activeFragmentsSlot,
  type Extension,
  type ExtensionChange,
  extensionContributionsSlot,
  extensionRefusalsSlot,
} from "../src/index.js";
import { archive, fragment, ids, membershipLog, newKernel } from "./helpers.js";

const LABELLED = {
  type: "object",
  required: ["label"],
  properties: { label: { type: "string" } },
};

/**
 * Core fragments opening the points the ticket names (commands, keybindings, menus,
 * settings pages, views, layouts, agent tools): their registries are the generic
 * extension registry, so their extensions are repaired like any other.
 */
const corePoints = {
  "system.commands": { client: ["commands", "keybindings"] },
  "system.workbench": { client: ["menus", "views", "layouts"] },
  "system.settings": { client: ["settings"] },
  "system.agents": { agent: ["tools"] },
} as const;

function coreArchive(id: string, points: Partial<Record<Aspect, readonly string[]>>) {
  const aspects: Record<string, unknown> = {};
  for (const [aspect, names] of Object.entries(points)) {
    aspects[aspect] = {
      extensionPoints: Object.fromEntries(names.map((n) => [n, { schema: LABELLED }])),
    };
  }
  return archive(fragment(id, { aspects }));
}

/** A fragment contributing one labelled extension to every core point. */
function contributorOf(id: string, extra: Record<string, unknown[]> = {}) {
  const client = Object.values(corePoints)
    .flatMap((p) => ("client" in p ? p.client : []))
    .map((point) => ({ point, data: { label: `${id} ${point}` } }));
  return archive(
    fragment(id, {
      aspects: {
        client: { extensions: [...client, ...(extra.client ?? [])] },
        agent: { extensions: [{ point: "tools", data: { label: `${id} tools` } }] },
      },
    }),
  );
}

/** Every core point observed by its owner: the change events each point received. */
async function platform() {
  const contexts = new Map<string, ActivationContext>();
  const record = (f: { id: string }, context: ActivationContext) => {
    contexts.set(`${context.aspect} ${f.id}`, context);
  };
  const { kernel, slots } = newKernel({
    core: Object.entries(corePoints).map(([id, p]) => coreArchive(id, p)),
    activators: { client: record, agent: record },
  });
  await kernel.start();
  await kernel.install([
    contributorOf("org.example.keep"),
    contributorOf("org.example.gone"),
    // A fragment opening its own point, which keep and a runtime contribution extend.
    archive(
      fragment("org.example.owner", {
        aspects: { client: { extensionPoints: { exporters: { schema: LABELLED } } } },
      }),
    ),
  ]);
  for (const id of ["org.example.keep", "org.example.gone", "org.example.owner"]) {
    await kernel.enable(id);
  }
  await kernel.activate("client");
  await kernel.activate("agent");

  const changes = new Map<string, ExtensionChange[]>();
  const current = new Map<string, readonly Extension[]>();
  for (const [key, context] of contexts) {
    for (const name of context.extensions.names) {
      const point = `${key.split(" ")[1]}/${name}`;
      changes.set(point, []);
      context.extensions.observe(name, (all, change) => {
        current.set(point, all);
        changes.get(point)?.push(change);
      });
      changes.set(point, []); // the initial call is not a change
    }
  }
  return { kernel, slots, contexts, changes, current };
}

const labels = (extensions: readonly Extension[] | undefined) =>
  (extensions ?? []).map((e) => (e.data as { label: string }).label);

describe("repair on removal", () => {
  it("drops the fragment's extensions from every registry with change events; nothing else changes", async () => {
    const { kernel, slots, changes, current } = await platform();
    const kept = new Map(
      [...current].map(([p, all]) => [p, all.filter((e) => e.contributor === "org.example.keep")]),
    );
    const active = membershipLog(slots, activeFragmentsSlot("client"));

    await kernel.remove("org.example.gone");

    const corePointIds = Object.entries(corePoints).flatMap(([id, p]) =>
      (Object.values(p) as (readonly string[])[]).flatMap((names) =>
        names.map((n) => `${id}/${n}`),
      ),
    );
    expect(corePointIds).toHaveLength(7);
    for (const point of corePointIds) {
      const [change, ...more] = changes.get(point) ?? [];
      expect(more).toEqual([]);
      expect(change?.added).toEqual([]);
      expect(labels(change?.removed)).toEqual([`org.example.gone ${point.split("/")[1]}`]);
      // The other contributor's extensions are the very same objects.
      expect(current.get(point)).toEqual(kept.get(point));
      for (const [i, e] of (current.get(point) ?? []).entries()) {
        expect(e).toBe(kept.get(point)?.[i]);
      }
    }
    // The point gone's extensions never touched saw no event.
    expect(changes.get("org.example.owner/exporters")).toEqual([]);
    // Only the removed fragment left the active state.
    expect(active.events).toEqual(["-org.example.gone"]);
  });

  it("drops its runtime contributions and their refusals, even malformed ones", async () => {
    const { kernel, slots, changes } = await platform();
    slots.register(extensionContributionsSlot("client"), "org.example.gone/pdf", {
      contributor: "org.example.gone",
      point: "org.example.owner/exporters",
      data: { label: "PDF" },
    });
    slots.register(extensionContributionsSlot("client"), "org.example.gone/broken", {
      contributor: "org.example.gone",
      point: "org.example.owner/exporters",
      data: { label: "x" },
      unexpected: true,
    } as never);
    expect(ids(slots.getSnapshot(extensionRefusalsSlot("client")))).toEqual([
      "org.example.gone/broken",
    ]);
    changes.set("org.example.owner/exporters", []);

    await kernel.remove("org.example.gone");

    const [change] = changes.get("org.example.owner/exporters") ?? [];
    expect(labels(change?.removed)).toEqual(["PDF"]);
    expect(ids(slots.getSnapshot(extensionRefusalsSlot("client")))).toEqual([]);
  });

  it("leaves the extensions to the removed fragment's points dormant, and drops their refusals", async () => {
    const { kernel, slots, contexts } = await platform();
    // keep extends the owner's point twice: once validly, once refused.
    await kernel.remove("org.example.keep");
    await kernel.install([
      contributorOf("org.example.keep", {
        client: [
          { point: "org.example.owner/exporters", data: { label: "Markdown" } },
          { point: "org.example.owner/exporters", data: { label: 42 } },
        ],
      }),
    ]);
    await kernel.enable("org.example.keep");
    await kernel.activate("client", "org.example.keep");
    expect(ids(slots.getSnapshot(extensionRefusalsSlot("client")))).toHaveLength(1);
    const ownerArchive = archive(
      fragment("org.example.owner", {
        aspects: { client: { extensionPoints: { exporters: { schema: LABELLED } } } },
      }),
    );

    await kernel.remove("org.example.owner");
    expect(ids(slots.getSnapshot(extensionRefusalsSlot("client")))).toEqual([]);
    // The extension waits; the contributor is still resolved and active.
    expect(slots.getSnapshot(activeFragmentsSlot("client")).has("org.example.keep")).toBe(true);

    await kernel.install([ownerArchive]);
    await kernel.enable("org.example.owner");
    await kernel.activate("client", "org.example.owner");
    const points = contexts.get("client org.example.owner")?.extensions;
    expect(labels(points?.read("exporters"))).toEqual(["Markdown"]);
    expect(ids(slots.getSnapshot(extensionRefusalsSlot("client")))).toHaveLength(1);
  });

  it("repairs the same way on disable", async () => {
    const { kernel, changes } = await platform();
    await kernel.disable("org.example.gone");
    const [change, ...more] = changes.get("system.workbench/menus") ?? [];
    expect(more).toEqual([]);
    expect(labels(change?.removed)).toEqual(["org.example.gone menus"]);
  });
});
