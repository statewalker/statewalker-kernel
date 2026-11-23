import { describe, expect, it, vi } from "vitest";
import {
  type ActivationContext,
  type Extension,
  ExtensionUnavailable,
  extensionContributionsSlot,
  type KernelOptions,
} from "../src/index.js";
import { archive, fragment, newKernel } from "./helpers.js";

/** An owner opening the client point `actions` (any data). */
const owner = archive(
  fragment("org.example.owner", {
    aspects: { client: { extensionPoints: { actions: { schema: true } } } },
  }),
);

/** A contributor whose one extension references `reference`. */
function contributor(reference: unknown) {
  return archive(
    fragment("org.example.a", {
      aspects: {
        client: { extensions: [{ point: "org.example.owner/actions", data: {}, reference }] },
      },
    }),
  );
}

/** Install the owner and a contributor, enable both, activate the client aspect. */
async function setup(reference: unknown, resolvers: KernelOptions["resolvers"]) {
  let context: ActivationContext | undefined;
  const { kernel, slots } = newKernel({
    resolvers,
    activators: {
      client: (f, c) => {
        if (f.id === "org.example.owner") context = c;
      },
    },
  });
  await kernel.install([owner, contributor(reference)]);
  await kernel.enable("org.example.owner");
  await kernel.enable("org.example.a");
  await kernel.activate("client");
  const [extension] = context?.extensions.read("actions") ?? [];
  if (!extension) throw new Error("no extension");
  return { kernel, slots, extension, context: context as ActivationContext };
}

const never = () => new Promise<never>(() => {});

describe("lazy references", () => {
  it("resolve through the host's resolver of their kind, for the point's owner", async () => {
    const module = vi.fn((_ref: unknown, _ctx: unknown) => ({ greet: (n: string) => `hi ${n}` }));
    const { extension } = await setup({ module: "./actions.js", export: "greet" }, { module });
    expect(module).not.toHaveBeenCalled(); // lazy
    expect(extension.reference?.kind).toBe("module");
    expect(extension.reference?.target).toEqual({ module: "./actions.js", export: "greet" });
    const value = await extension.reference?.resolve<{ greet(n: string): string }>();
    expect(value?.greet("you")).toBe("hi you");
    expect(module).toHaveBeenCalledWith(
      { module: "./actions.js", export: "greet" },
      expect.objectContaining({
        aspect: "client",
        owner: expect.objectContaining({ id: "org.example.owner" }),
        contributor: expect.objectContaining({ id: "org.example.a" }),
        extension,
      }),
    );
  });

  it("call a resolved function with `call`, for each kind", async () => {
    const resolvers = {
      module: () => (x: number) => x + 1,
      entrypoint: () => async (x: number) => x * 2,
      command: () => (x: number) => x - 1,
    };
    const results = [];
    for (const reference of [
      { module: "./m.js" },
      { entrypoint: "Api", method: "double" },
      { command: "org.example.a/dec" },
    ]) {
      const { extension } = await setup(reference, resolvers);
      results.push(await extension.reference?.call(10));
    }
    expect(results).toEqual([11, 20, 9]);
  });

  it("raise ExtensionUnavailable once the contributor is disabled", async () => {
    const { kernel, extension } = await setup({ command: "x" }, { command: () => () => "done" });
    const fn = await extension.reference?.resolve<() => string>();
    expect(fn?.()).toBe("done");
    await kernel.disable("org.example.a");
    await expect(extension.reference?.resolve()).rejects.toBeInstanceOf(ExtensionUnavailable);
    await expect(extension.reference?.call()).rejects.toBeInstanceOf(ExtensionUnavailable);
    // A function resolved before is guarded too.
    expect(() => fn?.()).toThrow(ExtensionUnavailable);
  });

  it("never hang: a pending resolution or call fails once the contributor goes", async () => {
    const { kernel, extension } = await setup({ module: "./slow.js" }, { module: never });
    const resolving = extension.reference?.resolve();
    await kernel.disable("org.example.a");
    await expect(resolving).rejects.toBeInstanceOf(ExtensionUnavailable);

    const again = await setup({ module: "./hangs.js" }, { module: () => never });
    const calling = again.extension.reference?.call();
    await again.kernel.disable("org.example.a");
    await expect(calling).rejects.toBeInstanceOf(ExtensionUnavailable);
  });

  it("raise ExtensionUnavailable when the runtime contribution is withdrawn", async () => {
    let context: ActivationContext | undefined;
    const { kernel, slots } = newKernel({
      resolvers: { command: () => () => "ok" },
      activators: {
        client: (f, c) => {
          if (f.id === "org.example.owner") context = c;
        },
      },
    });
    await kernel.install([owner, contributor(undefined)]);
    await kernel.enable("org.example.owner");
    await kernel.enable("org.example.a");
    await kernel.activate("client");
    const withdraw = slots.register(extensionContributionsSlot("client"), "org.example.a/run", {
      contributor: "org.example.a",
      point: "org.example.owner/actions",
      data: {},
      reference: { command: "org.example.a/run" },
    });
    const runtime = context?.extensions.read("actions").find((e) => e.id === "org.example.a/run");
    expect(await runtime?.reference?.call()).toBe("ok");
    withdraw();
    await expect(runtime?.reference?.call()).rejects.toBeInstanceOf(ExtensionUnavailable);
  });

  it("raise ExtensionUnavailable once the owner's aspect is deactivated", async () => {
    const { kernel, extension } = await setup({ command: "x" }, { command: () => () => "done" });
    await kernel.deactivate("client", "org.example.owner");
    await expect(extension.reference?.call()).rejects.toBeInstanceOf(ExtensionUnavailable);
  });

  it("raise ExtensionUnavailable when the host has no resolver for the kind", async () => {
    const { extension } = await setup({ entrypoint: "Api", method: "m" }, {});
    const error = await extension.reference?.resolve().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExtensionUnavailable);
    expect(error).toMatchObject({ extension: "org.example.a#0", contributor: "org.example.a" });
  });

  it("carry no reference when the extension declares none", async () => {
    const { extension } = await setup(undefined, {});
    expect((extension as Extension).reference).toBeUndefined();
  });
});

describe("only the point's owner", () => {
  /** A core fragment opening no point, activated beside the owner and the contributor. */
  async function withCoreNonOwner() {
    const contexts = new Map<string, ActivationContext>();
    const command = vi.fn(() => () => "contributed");
    const { kernel } = newKernel({
      core: [archive(fragment("system.workbench", { aspects: { client: {} } }))],
      resolvers: { command },
      activators: { client: (f, c) => void contexts.set(f.id, c) },
    });
    await kernel.start();
    await kernel.install([owner, contributor({ command: "c" })]);
    await kernel.enable("org.example.owner");
    await kernel.enable("org.example.a");
    await kernel.activate("client");
    const core = contexts.get("system.workbench");
    if (!core) throw new Error("system.workbench not activated");
    return { core, command };
  }

  it("reads extensions: a core fragment cannot read another owner's point by its full id", async () => {
    const { core, command } = await withCoreNonOwner();
    expect(core.extensions.names).toEqual([]);
    expect(core.extensions.read("org.example.owner/actions")).toEqual([]);
    expect(command).not.toHaveBeenCalled();
  });

  it("observes extensions: a core fragment observing another owner's point hears nothing", async () => {
    const { core } = await withCoreNonOwner();
    const listener = vi.fn();
    core.extensions.observe("org.example.owner/actions", listener);
    expect(listener).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.anything()]),
      expect.anything(),
    );
    expect(core.extensions.read("org.example.owner/actions")).toEqual([]);
  });
});
