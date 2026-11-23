import { describe, expect, it, vi } from "vitest";
import type { ActivationContext, Extension, ExtensionRegistryOptions } from "../src/index.js";
import {
  extensionContributionsSlot,
  extensionRefusalsSlot,
  FragmentInstallError,
  resolvedFragmentsSlot,
} from "../src/index.js";
import { archive, fragment, ids, newKernel } from "./helpers.js";

const MENU_SCHEMA = {
  type: "object",
  required: ["label"],
  additionalProperties: false,
  properties: { label: { type: "string" } },
};

/** An owner declaring the client point `menus`. */
function owner(id = "org.example.owner") {
  return archive(
    fragment(id, {
      aspects: { client: { extensionPoints: { menus: { schema: MENU_SCHEMA } } } },
    }),
  );
}

/** A fragment contributing `extensions` to client points. */
function contributor(id: string, extensions: unknown[]) {
  return archive(fragment(id, { aspects: { client: { extensions } } }));
}

/**
 * A kernel whose client activator keeps each fragment's activation context, so a test
 * reads the registry as the point's owner does.
 */
function kernelWithContexts(options: ExtensionRegistryOptions = {}) {
  const contexts = new Map<string, ActivationContext>();
  const { kernel, slots } = newKernel({
    ...options,
    activators: {
      client: (f, context) => {
        contexts.set(f.id, context);
      },
    },
  });
  return { kernel, slots, contexts };
}

const labels = (extensions: readonly Extension[]) =>
  extensions.map((e) => (e.data as { label: string }).label);

describe("static extensions", () => {
  it("are read by the point's owner", async () => {
    const { kernel, contexts } = kernelWithContexts();
    await kernel.install([
      owner(),
      contributor("org.example.a", [{ point: "org.example.owner/menus", data: { label: "Open" } }]),
    ]);
    await kernel.enable("org.example.owner");
    await kernel.enable("org.example.a");
    await kernel.activate("client", "org.example.owner");
    const points = contexts.get("org.example.owner")?.extensions;
    expect(points?.names).toEqual(["menus"]);
    const [ext] = points?.read("menus") ?? [];
    expect(ext).toMatchObject({
      point: "org.example.owner/menus",
      contributor: "org.example.a",
      aspect: "client",
      data: { label: "Open" },
    });
    expect(labels(points?.read("menus") ?? [])).toEqual(["Open"]);
  });
});

describe("the owner's stream", () => {
  it("reports extensions added and removed as contributors are enabled and disabled", async () => {
    const { kernel, contexts } = kernelWithContexts();
    await kernel.install([owner()]);
    await kernel.enable("org.example.owner");
    await kernel.activate("client");
    const events: string[] = [];
    contexts.get("org.example.owner")?.extensions.observe("menus", (all, { added, removed }) => {
      events.push(`[${labels(all)}] +[${labels(added)}] -[${labels(removed)}]`);
    });
    await kernel.install([
      contributor("org.example.a", [{ point: "org.example.owner/menus", data: { label: "A" } }]),
      contributor("org.example.b", [{ point: "org.example.owner/menus", data: { label: "B" } }]),
    ]);
    await kernel.enable("org.example.a");
    await kernel.enable("org.example.b");
    await kernel.disable("org.example.a");
    expect(events).toEqual(["[] +[] -[]", "[A] +[A] -[]", "[A,B] +[B] -[]", "[B] +[] -[A]"]);
  });
});

describe("dormant extensions", () => {
  it("wait for their owner and are picked up when it is installed", async () => {
    const { kernel, contexts } = kernelWithContexts();
    await kernel.install([
      contributor("org.example.a", [{ point: "org.example.owner/menus", data: { label: "A" } }]),
    ]);
    await kernel.enable("org.example.a");
    await kernel.activate("client");
    await kernel.install([owner()]);
    await kernel.enable("org.example.owner");
    await kernel.activate("client");
    expect(labels(contexts.get("org.example.owner")?.extensions.read("menus") ?? [])).toEqual([
      "A",
    ]);
  });

  it("go dormant again when the owner is disabled, and come back with it", async () => {
    const { kernel, contexts } = kernelWithContexts();
    await kernel.install([
      owner(),
      contributor("org.example.a", [{ point: "org.example.owner/menus", data: { label: "A" } }]),
    ]);
    await kernel.enable("org.example.a");
    await kernel.enable("org.example.owner");
    await kernel.activate("client");
    await kernel.disable("org.example.owner");
    await kernel.enable("org.example.owner");
    await kernel.activate("client");
    expect(labels(contexts.get("org.example.owner")?.extensions.read("menus") ?? [])).toEqual([
      "A",
    ]);
  });
});

describe("runtime extensions", () => {
  it("join the static ones in one stream, and leave it when disposed", async () => {
    const { kernel, slots, contexts } = kernelWithContexts();
    await kernel.install([
      owner(),
      contributor("org.example.a", [
        { point: "org.example.owner/menus", data: { label: "Static" } },
      ]),
    ]);
    await kernel.enable("org.example.owner");
    await kernel.enable("org.example.a");
    await kernel.activate("client");
    const events: string[] = [];
    contexts.get("org.example.owner")?.extensions.observe("menus", (all, { added, removed }) => {
      events.push(`[${labels(all)}] +[${labels(added)}] -[${labels(removed)}]`);
    });
    const dispose = slots.register(extensionContributionsSlot("client"), "org.example.a/runtime", {
      contributor: "org.example.a",
      point: "org.example.owner/menus",
      data: { label: "Runtime" },
    });
    dispose();
    expect(events).toEqual([
      "[Static] +[Static] -[]",
      "[Static,Runtime] +[Runtime] -[]",
      "[Static] +[] -[Runtime]",
    ]);
  });

  it("are gone while their contributor is disabled", async () => {
    const { kernel, slots, contexts } = kernelWithContexts();
    await kernel.install([owner(), contributor("org.example.a", [])]);
    await kernel.enable("org.example.owner");
    await kernel.activate("client");
    slots.register(extensionContributionsSlot("client"), "org.example.a/runtime", {
      contributor: "org.example.a",
      point: "org.example.owner/menus",
      data: { label: "Runtime" },
    });
    const points = contexts.get("org.example.owner")?.extensions;
    expect(labels(points?.read("menus") ?? [])).toEqual([]);
    await kernel.enable("org.example.a");
    expect(labels(points?.read("menus") ?? [])).toEqual(["Runtime"]);
    await kernel.disable("org.example.a");
    expect(labels(points?.read("menus") ?? [])).toEqual([]);
  });
});

describe("validation", () => {
  it("refuses an extension whose data does not match the point's schema, with a reason", async () => {
    const { kernel, slots, contexts } = kernelWithContexts();
    await kernel.install([
      owner(),
      contributor("org.example.a", [
        { point: "org.example.owner/menus", data: { label: "Good" } },
        { point: "org.example.owner/menus", data: { title: "Bad" } },
      ]),
    ]);
    await kernel.enable("org.example.owner");
    await kernel.enable("org.example.a");
    await kernel.activate("client");
    expect(labels(contexts.get("org.example.owner")?.extensions.read("menus") ?? [])).toEqual([
      "Good",
    ]);
    const refused = slots.getSnapshot(extensionRefusalsSlot("client"));
    expect([...refused.keys()]).toEqual(["org.example.a#1"]);
    expect(refused.get("org.example.a#1")).toMatchObject({
      id: "org.example.a#1",
      contributor: "org.example.a",
      point: "org.example.owner/menus",
      code: "invalid-data",
      message: expect.stringContaining("label"),
    });
    // The refusal goes with the contributor.
    await kernel.disable("org.example.a");
    expect(slots.getSnapshot(extensionRefusalsSlot("client")).size).toBe(0);
  });

  it("checks a dormant extension only once its owner arrives", async () => {
    const { kernel, slots } = kernelWithContexts();
    await kernel.install([
      contributor("org.example.a", [{ point: "org.example.owner/menus", data: { title: "Bad" } }]),
    ]);
    await kernel.enable("org.example.a");
    expect(slots.getSnapshot(extensionRefusalsSlot("client")).size).toBe(0);
    await kernel.install([owner()]);
    await kernel.enable("org.example.owner");
    expect([...slots.getSnapshot(extensionRefusalsSlot("client")).keys()]).toEqual([
      "org.example.a#0",
    ]);
  });

  it("refuses an extension to a point the owner opens in another aspect", async () => {
    const { kernel, slots } = kernelWithContexts();
    await kernel.install([
      owner(),
      archive(
        fragment("org.example.a", {
          aspects: {
            agent: { extensions: [{ point: "org.example.owner/menus", data: { label: "A" } }] },
          },
        }),
      ),
    ]);
    await kernel.enable("org.example.owner");
    await kernel.enable("org.example.a");
    expect(slots.get(extensionRefusalsSlot("agent"), "org.example.a#0")).toMatchObject({
      code: "wrong-aspect",
    });
  });

  it("refuses a runtime contribution not keyed under its contributor, or malformed", async () => {
    const { kernel, slots, contexts } = kernelWithContexts();
    await kernel.install([owner(), contributor("org.example.a", [])]);
    await kernel.enable("org.example.owner");
    await kernel.enable("org.example.a");
    await kernel.activate("client");
    const contributions = extensionContributionsSlot("client");
    slots.register(contributions, "org.example.other/x", {
      contributor: "org.example.a",
      point: "org.example.owner/menus",
      data: { label: "Elsewhere" },
    });
    slots.register(contributions, "org.example.a/bad-ref", {
      contributor: "org.example.a",
      point: "org.example.owner/menus",
      data: { label: "Bad ref" },
      reference: { module: "" },
    });
    expect(contexts.get("org.example.owner")?.extensions.read("menus")).toEqual([]);
    const refused = slots.getSnapshot(extensionRefusalsSlot("client"));
    expect(refused.get("org.example.other/x")?.code).toBe("invalid-contribution");
    expect(refused.get("org.example.a/bad-ref")?.code).toBe("invalid-contribution");
  });
});

describe("core extension points", () => {
  it("are known by their short name", async () => {
    const workbench = archive(
      fragment("system.workbench", {
        aspects: { client: { extensionPoints: { menus: { schema: MENU_SCHEMA } } } },
      }),
    );
    const { kernel, contexts } = (() => {
      const contexts = new Map<string, ActivationContext>();
      const { kernel } = newKernel({
        core: [workbench],
        activators: { client: (f, c) => void contexts.set(f.id, c) },
      });
      return { kernel, contexts };
    })();
    await kernel.start();
    await kernel.install([
      contributor("org.example.a", [{ point: "menus", data: { label: "Short" } }]),
    ]);
    await kernel.enable("org.example.a");
    await kernel.activate("client");
    const [ext] = contexts.get("system.workbench")?.extensions.read("menus") ?? [];
    expect(ext).toMatchObject({ point: "menus", data: { label: "Short" } });
  });
});

describe("extension points in the manifest", () => {
  const point = { schema: true };
  it.each([
    [
      "two core fragments opening one short point",
      [
        archive(
          fragment("system.one", { aspects: { client: { extensionPoints: { menus: point } } } }),
        ),
        archive(
          fragment("system.two", { aspects: { agent: { extensionPoints: { menus: point } } } }),
        ),
      ],
      "extension-point-conflict",
    ],
    [
      "one fragment opening a name in two aspects",
      [
        archive(
          fragment("system.one", {
            aspects: {
              client: { extensionPoints: { menus: point } },
              agent: { extensionPoints: { menus: point } },
            },
          }),
        ),
      ],
      "invalid-manifest",
    ],
    [
      "a point name that is not lowercase",
      [
        archive(
          fragment("system.one", { aspects: { client: { extensionPoints: { Menus: point } } } }),
        ),
      ],
      "invalid-manifest",
    ],
    [
      "an extension with a malformed reference",
      [
        archive(
          fragment("system.one", {
            aspects: {
              client: {
                extensions: [
                  { point: "menus", data: {}, reference: { module: "./a.js", method: "x" } },
                ],
              },
            },
          }),
        ),
      ],
      "invalid-manifest",
    ],
  ])("refuses %s", async (_label, core, code) => {
    const { kernel } = newKernel({ core });
    const error = await kernel.start().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FragmentInstallError);
    expect((error as FragmentInstallError).refusals[0]).toMatchObject({ code });
  });
});

describe("the owner's activator", () => {
  it("reads and follows its points while it runs, although kernel calls are refused then", async () => {
    let seen: string[] = [];
    let followed: string[] = [];
    const { kernel } = newKernel({
      activators: {
        client: (f, context) => {
          if (f.id !== "org.example.owner") return;
          seen = labels(context.extensions.read("menus"));
          const stop = context.extensions.observe("menus", (all) => {
            followed = labels(all);
          });
          return stop;
        },
      },
    });
    await kernel.install([
      owner(),
      contributor("org.example.a", [{ point: "org.example.owner/menus", data: { label: "A" } }]),
    ]);
    await kernel.enable("org.example.owner");
    await kernel.enable("org.example.a");
    await kernel.activate("client", "org.example.owner");
    expect(seen).toEqual(["A"]);
    await kernel.disable("org.example.a");
    expect(followed).toEqual([]);
  });

  it("stops hearing about its points once its aspect is deactivated", async () => {
    const { kernel, contexts } = kernelWithContexts();
    await kernel.install([
      owner(),
      contributor("org.example.a", [{ point: "org.example.owner/menus", data: { label: "A" } }]),
    ]);
    await kernel.enable("org.example.owner");
    await kernel.activate("client");
    const heard: string[][] = [];
    contexts
      .get("org.example.owner")
      ?.extensions.observe("menus", (all) => heard.push(labels(all)));
    await kernel.deactivate("client", "org.example.owner");
    await kernel.enable("org.example.a");
    expect(heard).toEqual([[]]);
    expect(contexts.get("org.example.owner")?.extensions.read("menus")).toEqual([]);
  });

  it("has a listener that throws reported, without stopping the kernel or other listeners", async () => {
    const onError = vi.fn();
    const contexts = new Map<string, ActivationContext>();
    const { kernel, slots } = newKernel({
      onError,
      activators: { client: (f, c) => void contexts.set(f.id, c) },
    });
    await kernel.install([
      owner(),
      contributor("org.example.a", [{ point: "org.example.owner/menus", data: { label: "A" } }]),
    ]);
    await kernel.enable("org.example.owner");
    await kernel.activate("client");
    const boom = new Error("listener failed");
    const points = contexts.get("org.example.owner")?.extensions;
    let calls = 0;
    points?.observe("menus", (_all, { added }) => {
      if (added.length > 0) throw boom;
    });
    points?.observe("menus", () => {
      calls++;
    });
    await kernel.enable("org.example.a");
    expect(calls).toBe(2);
    expect(onError).toHaveBeenCalledWith("org.example.owner", "client", boom);
    expect(ids(slots.getSnapshot(resolvedFragmentsSlot))).toContain("org.example.a");
  });
});

describe("a point whose schema cannot be applied", () => {
  it("refuses its extensions with a reason, and the kernel carries on", async () => {
    const { kernel, slots } = kernelWithContexts();
    await kernel.install([
      archive(
        fragment("org.example.owner", {
          aspects: {
            client: { extensionPoints: { menus: { schema: { $ref: "#/$defs/missing" } } } },
          },
        }),
      ),
      contributor("org.example.a", [{ point: "org.example.owner/menus", data: { label: "A" } }]),
    ]);
    await kernel.enable("org.example.a");
    await kernel.enable("org.example.owner");
    expect(ids(slots.getSnapshot(resolvedFragmentsSlot)).sort()).toEqual([
      "org.example.a",
      "org.example.owner",
    ]);
    expect(slots.get(extensionRefusalsSlot("client"), "org.example.a#0")).toMatchObject({
      code: "invalid-data",
      message: expect.stringContaining("schema"),
    });
  });
});
