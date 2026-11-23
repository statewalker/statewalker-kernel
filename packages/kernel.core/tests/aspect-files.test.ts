import { describe, expect, it } from "vitest";
import {
  type ActivationContext,
  FragmentInstallError,
  installedFragmentsSlot,
} from "../src/index.js";
import { aspectJsonc, fragmentJsonc, ids, newKernel } from "./helpers.js";

/** A manifest with the given aspects present (each `{}`). */
function manifest(id: string, aspects: string[]) {
  return fragmentJsonc({
    id,
    version: "1.0.0",
    engines: { platform: "^1.0.0" },
    aspects: Object.fromEntries(aspects.map((a) => [a, {}])),
  });
}

async function refusalsOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(FragmentInstallError);
  return (error as FragmentInstallError).refusals;
}

const wrangler = (id: string) => JSON.stringify({ name: id.replaceAll(".", "-") });

describe("aspect files", () => {
  it("are read beside fragment.jsonc: points and extensions of the client and agent aspects", async () => {
    const contexts = new Map<string, ActivationContext>();
    const { kernel } = newKernel({
      activators: { agent: (f, c) => void contexts.set(f.id, c) },
    });
    await kernel.install([
      {
        "fragment.jsonc": manifest("org.example.owner", ["client", "agent"]),
        "fragment.client.jsonc": aspectJsonc({}),
        "fragment.agent.jsonc": aspectJsonc({
          extensionPoints: { tools: { schema: true } },
          extensions: [{ point: "org.example.owner/tools", data: { name: "self" } }],
        }),
      },
    ]);
    await kernel.enable("org.example.owner");
    await kernel.activate("agent");
    const [ext] = contexts.get("org.example.owner")?.extensions.read("tools") ?? [];
    expect(ext).toMatchObject({ aspect: "agent", data: { name: "self" } });
  });

  it("take the server aspect's points from fragment.server.jsonc, beside an unchanged wrangler.jsonc", async () => {
    const contexts = new Map<string, ActivationContext>();
    const { kernel } = newKernel({
      activators: { server: (f, c) => void contexts.set(f.id, c) },
    });
    await kernel.install([
      {
        "fragment.jsonc": manifest("org.example.owner", ["server"]),
        "wrangler.jsonc": wrangler("org.example.owner"),
        "fragment.server.jsonc": aspectJsonc({
          extensionPoints: { sources: { schema: true } },
        }),
      },
      {
        "fragment.jsonc": manifest("org.example.a", ["server"]),
        "wrangler.jsonc": wrangler("org.example.a"),
        "fragment.server.jsonc": aspectJsonc({
          extensions: [
            {
              point: "org.example.owner/sources",
              data: {},
              reference: { entrypoint: "Source", method: "list" },
            },
          ],
        }),
      },
      // A server half needs no fragment.server.jsonc.
      {
        "fragment.jsonc": manifest("org.example.b", ["server"]),
        "wrangler.jsonc": wrangler("org.example.b"),
      },
    ]);
    for (const id of ["org.example.owner", "org.example.a", "org.example.b"]) {
      await kernel.enable(id);
    }
    await kernel.activate("server");
    const [ext] = contexts.get("org.example.owner")?.extensions.read("sources") ?? [];
    expect(ext?.reference?.target).toEqual({ entrypoint: "Source", method: "list" });
  });

  it.each([
    [
      "a client aspect without fragment.client.jsonc",
      { "fragment.jsonc": manifest("org.example.x", ["client"]) },
      "fragment.client.jsonc",
    ],
    [
      "an agent aspect without fragment.agent.jsonc",
      { "fragment.jsonc": manifest("org.example.x", ["agent"]) },
      "fragment.agent.jsonc",
    ],
    [
      "fragment.agent.jsonc without the agent aspect",
      {
        "fragment.jsonc": manifest("org.example.x", ["client"]),
        "fragment.client.jsonc": aspectJsonc({}),
        "fragment.agent.jsonc": aspectJsonc({}),
      },
      "fragment.agent.jsonc",
    ],
    [
      "fragment.server.jsonc without the server aspect",
      {
        "fragment.jsonc": manifest("org.example.x", ["client"]),
        "fragment.client.jsonc": aspectJsonc({}),
        "fragment.server.jsonc": aspectJsonc({}),
      },
      "fragment.server.jsonc",
    ],
    [
      "an aspect file that does not parse",
      {
        "fragment.jsonc": manifest("org.example.x", ["client"]),
        "fragment.client.jsonc": "{ nope",
      },
      "fragment.client.jsonc",
    ],
    [
      "an aspect file with an unknown $schema",
      {
        "fragment.jsonc": manifest("org.example.x", ["client"]),
        "fragment.client.jsonc": JSON.stringify({ $schema: "./fragment-aspect.v9.schema.json" }),
      },
      "fragment.client.jsonc",
    ],
    [
      "an aspect file that does not match its schema",
      {
        "fragment.jsonc": manifest("org.example.x", ["client"]),
        "fragment.client.jsonc": aspectJsonc({ extensions: [{ point: "Bad Point", data: {} }] }),
      },
      "fragment.client.jsonc",
    ],
    [
      "one point name opened in two aspects",
      {
        "fragment.jsonc": manifest("org.example.x", ["client", "agent"]),
        "fragment.client.jsonc": aspectJsonc({ extensionPoints: { menus: { schema: true } } }),
        "fragment.agent.jsonc": aspectJsonc({ extensionPoints: { menus: { schema: true } } }),
      },
      "menus",
    ],
    [
      "extension points in fragment.jsonc itself",
      {
        "fragment.jsonc": fragmentJsonc({
          id: "org.example.x",
          version: "1.0.0",
          engines: { platform: "^1.0.0" },
          aspects: { client: { extensionPoints: { menus: { schema: true } } } },
        }),
        "fragment.client.jsonc": aspectJsonc({}),
      },
      "fragment.jsonc",
    ],
  ])("refuse %s, installing nothing", async (_label, files, named) => {
    const { kernel, slots } = newKernel();
    const good = {
      "fragment.jsonc": manifest("org.example.good", ["client"]),
      "fragment.client.jsonc": aspectJsonc({}),
    };
    const [refusal, ...rest] = await refusalsOf(kernel.install([good, files]));
    expect(rest).toEqual([]);
    expect(refusal).toMatchObject({ id: "org.example.x", code: "invalid-manifest" });
    expect(refusal?.message).toContain(named);
    expect(ids(slots.getSnapshot(installedFragmentsSlot))).toEqual([]);
  });
});
