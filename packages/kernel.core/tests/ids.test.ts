import { describe, expect, it } from "vitest";
import {
  enabledFragmentsSlot,
  FragmentInstallError,
  installedFragmentsSlot,
  workerNameOf,
} from "../src/index.js";
import { archive, ids, newKernel } from "./helpers.js";

function manifest(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    version: "1.0.0",
    engines: { platform: "^1.0.0" },
    aspects: { client: {} },
    ...extra,
  };
}

async function refusalOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(FragmentInstallError);
  return (error as FragmentInstallError).refusals[0];
}

describe("fragment ids", () => {
  it.each(["org.example.notes", "org.statewalker.fragment-notes", "com.acme", "io.x2.a-b.c9"])(
    "accepts the reverse-domain id %s",
    async (id) => {
      const { kernel, slots } = newKernel();
      await kernel.install([archive(manifest(id))]);
      expect(ids(slots.getSnapshot(installedFragmentsSlot))).toEqual([id]);
    },
  );

  it.each([
    "notes",
    "Org.Example.Notes",
    "org..notes",
    "org.example.",
    ".org.example",
    "org.example.-notes",
    "org.example.notes-",
    "org.example.my_notes",
    "org.9example.notes",
    "org example.notes",
  ])("refuses the id %j, which is not reverse-domain", async (id) => {
    const { kernel } = newKernel();
    expect(await refusalOf(kernel.install([archive(manifest(id))]))).toMatchObject({
      code: "invalid-id",
    });
  });

  it("refuses the system. prefix from a fragment not shipped with the platform", async () => {
    const { kernel, slots } = newKernel();
    const refusal = await refusalOf(kernel.install([archive(manifest("system.commands"))]));
    expect(refusal).toMatchObject({ id: "system.commands", code: "reserved-id" });
    expect(ids(slots.getSnapshot(installedFragmentsSlot))).toEqual([]);
  });

  it("installs and enables the core fragments shipped with the platform, system. ids included", async () => {
    const { kernel, slots } = newKernel({ core: [archive(manifest("system.commands"))] });
    await kernel.start();
    expect(ids(slots.getSnapshot(installedFragmentsSlot))).toEqual(["system.commands"]);
    expect(ids(slots.getSnapshot(enabledFragmentsSlot))).toEqual(["system.commands"]);
    expect(slots.get(installedFragmentsSlot, "system.commands")?.core).toBe(true);
  });

  it("refuses a duplicate id within one install", async () => {
    const { kernel } = newKernel();
    const refusal = await refusalOf(
      kernel.install([archive(manifest("org.example.a")), archive(manifest("org.example.a"))]),
    );
    expect(refusal).toMatchObject({ id: "org.example.a", code: "already-installed" });
  });
});

describe("a server half's Worker name", () => {
  const server = (id: string) => manifest(id, { aspects: { server: {} } });

  it("is derived from the id", () => {
    expect(workerNameOf("org.statewalker.fragment-notes")).toBe("org-statewalker-fragment-notes");
    expect(workerNameOf("system.commands")).toBe("system-commands");
  });

  it("accepts a wrangler.jsonc named after the id", async () => {
    const { kernel, slots } = newKernel();
    await kernel.install([
      archive(server("org.example.notes"), {
        "wrangler.jsonc": '{\n  // the server half\n  "name": "org-example-notes",\n}',
      }),
    ]);
    expect(ids(slots.getSnapshot(installedFragmentsSlot))).toEqual(["org.example.notes"]);
  });

  it("refuses a wrangler.jsonc with another name", async () => {
    const { kernel } = newKernel();
    const refusal = await refusalOf(
      kernel.install([
        archive(server("org.example.notes"), { "wrangler.jsonc": '{"name":"notes"}' }),
      ]),
    );
    expect(refusal).toMatchObject({ id: "org.example.notes", code: "worker-name" });
    expect(refusal?.message).toContain("org-example-notes");
  });

  it("refuses a server aspect without a wrangler.jsonc", async () => {
    const { kernel } = newKernel();
    const refusal = await refusalOf(kernel.install([archive(server("org.example.notes"))]));
    expect(refusal).toMatchObject({ code: "worker-name" });
  });

  it("refuses an id whose Worker name would be longer than 63 characters", async () => {
    const { kernel } = newKernel();
    const id = `org.example.${"a".repeat(60)}`;
    const refusal = await refusalOf(
      kernel.install([archive(server(id), { "wrangler.jsonc": `{"name":"${workerNameOf(id)}"}` })]),
    );
    expect(refusal).toMatchObject({ code: "worker-name" });
  });

  it("refuses a Worker name an installed fragment already has", async () => {
    const { kernel } = newKernel();
    await kernel.install([
      archive(server("org.example.notes"), { "wrangler.jsonc": '{"name":"org-example-notes"}' }),
    ]);
    const refusal = await refusalOf(
      kernel.install([
        archive(server("org.example-notes"), { "wrangler.jsonc": '{"name":"org-example-notes"}' }),
      ]),
    );
    expect(refusal).toMatchObject({ id: "org.example-notes", code: "worker-name" });
  });
});
