import { describe, expect, it, vi } from "vitest";
import { type AspectActivator, activeFragmentsSlot, FragmentLifecycleError } from "../src/index.js";
import { archive, fragment, ids, newKernel } from "./helpers.js";

/** b requires a, c requires b, d stands alone; all enabled. */
async function setup(client: AspectActivator, onError = vi.fn()) {
  const { kernel, slots } = newKernel({ activators: { client }, onError });
  await kernel.install([
    archive(fragment("org.example.a")),
    archive(fragment("org.example.b", { requires: { "org.example.a": "^1.0.0" } })),
    archive(fragment("org.example.c", { requires: { "org.example.b": "^1.0.0" } })),
    archive(fragment("org.example.d")),
  ]);
  for (const id of ["org.example.a", "org.example.b", "org.example.c", "org.example.d"]) {
    await kernel.enable(id);
  }
  return { kernel, slots, onError };
}

describe("aspect activators", () => {
  it("runs the host's activator for each fragment, and its cleanup on deactivation", async () => {
    const log: string[] = [];
    const { kernel } = await setup(async (f) => {
      log.push(`activate ${f.id}`);
      return async () => {
        log.push(`cleanup ${f.id}`);
      };
    });
    await kernel.activate("client", "org.example.c");
    await kernel.stop();
    expect(log).toEqual([
      "activate org.example.a",
      "activate org.example.b",
      "activate org.example.c",
      "cleanup org.example.c",
      "cleanup org.example.b",
      "cleanup org.example.a",
    ]);
  });

  it("marks a fragment active only once its activator has finished", async () => {
    let seen: string[] | undefined;
    const { kernel, slots } = await setup((f) => {
      if (f.id === "org.example.d") seen = ids(slots.getSnapshot(activeFragmentsSlot("client")));
    });
    await kernel.activate("client", "org.example.d");
    expect(seen).toEqual([]);
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client")))).toEqual(["org.example.d"]);
  });

  it("isolates a failing activation: the fragments requiring it stay inactive, the others activate", async () => {
    const boom = new Error("boom");
    const { kernel, slots, onError } = await setup((f) => {
      if (f.id === "org.example.b") throw boom;
    });
    await kernel.activate("client");
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client"))).sort()).toEqual([
      "org.example.a",
      "org.example.d",
    ]);
    expect(onError).toHaveBeenCalledWith("org.example.b", "client", boom);
  });

  it("reports a failing cleanup and still deactivates the rest", async () => {
    const boom = new Error("cleanup failed");
    const { kernel, slots, onError } = await setup((f) =>
      f.id === "org.example.b"
        ? () => {
            throw boom;
          }
        : undefined,
    );
    await kernel.activate("client");
    await kernel.stop();
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client")))).toEqual([]);
    expect(onError).toHaveBeenCalledWith("org.example.b", "client", boom);
  });

  it("runs lifecycle operations one after another, in the order they were called", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { kernel, slots } = await setup(async () => {
      await gate;
    });
    const activating = kernel.activate("client", "org.example.d");
    const deactivating = kernel.deactivate("client", "org.example.d");
    release();
    await Promise.all([activating, deactivating]);
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client")))).toEqual([]);
  });
});

/** a requires b, b requires c; b has only an agent aspect, a and c have a client aspect. */
async function throughAgentOnly(client: AspectActivator, onError = vi.fn()) {
  const { kernel, slots } = newKernel({ activators: { client }, onError });
  await kernel.install([
    archive(fragment("org.example.c")),
    archive(
      fragment("org.example.b", {
        aspects: { agent: {} },
        requires: { "org.example.c": "^1.0.0" },
      }),
    ),
    archive(fragment("org.example.a", { requires: { "org.example.b": "^1.0.0" } })),
  ]);
  for (const id of ["org.example.c", "org.example.b", "org.example.a"]) await kernel.enable(id);
  return { kernel, slots, onError };
}

describe("requirements through a fragment without the aspect", () => {
  it("deactivates a fragment that requires another through one lacking the aspect", async () => {
    const { kernel, slots } = await throughAgentOnly(() => {});
    await kernel.activate("client", "org.example.a");
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client"))).sort()).toEqual([
      "org.example.a",
      "org.example.c",
    ]);
    await kernel.deactivate("client", "org.example.c");
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client")))).toEqual([]);
  });

  it("does not activate a fragment whose indirect requirement failed to activate", async () => {
    const { kernel, slots } = await throughAgentOnly((f) => {
      if (f.id === "org.example.c") throw new Error("boom");
    });
    await kernel.activate("client");
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client")))).toEqual([]);
  });
});

describe("kernel operations from inside an activator", () => {
  it("are refused at once instead of waiting forever on the running operation", async () => {
    let inner: Promise<unknown> | undefined;
    const onError = vi.fn();
    const { kernel, slots } = newKernel({
      activators: {
        client: async () => {
          inner = kernel.enable("org.example.other");
          await inner;
        },
      },
      onError,
    });
    await kernel.install([
      archive(fragment("org.example.x")),
      archive(fragment("org.example.other")),
    ]);
    await kernel.enable("org.example.x");
    const outcome = await Promise.race([
      kernel.activate("client", "org.example.x").then(() => "settled"),
      new Promise((r) => setTimeout(() => r("hung"), 500)),
    ]);
    expect(outcome).toBe("settled");
    await expect(inner).rejects.toBeInstanceOf(FragmentLifecycleError);
    expect(onError).toHaveBeenCalledWith(
      "org.example.x",
      "client",
      expect.any(FragmentLifecycleError),
    );
    expect(ids(slots.getSnapshot(activeFragmentsSlot("client")))).toEqual([]);
    // The kernel still works afterwards.
    await kernel.enable("org.example.other");
    await kernel.stop();
  });
});
