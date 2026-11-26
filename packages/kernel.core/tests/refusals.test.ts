import { describe, expect, it } from "vitest";
import { FragmentInstallError, installedFragmentsSlot } from "../src/index.js";
import { archive, ids, newKernel } from "./helpers.js";

const base = {
  id: "org.example.notes",
  version: "1.0.0",
  engines: { platform: "^1.0.0" },
  aspects: { client: {} },
};

/** The refusals an install rejects with. */
async function refusals(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(FragmentInstallError);
  return (error as FragmentInstallError).refusals;
}

describe("install refusals", () => {
  it.each([
    ["no version", { ...base, version: undefined }],
    ["a version that is not semver", { ...base, version: "one" }],
    ["an aspect the platform does not fix", { ...base, aspects: { client: {}, styles: {} } }],
    ["an unknown top-level key", { ...base, namespace: "org.example" }],
    ["requires that is not a map of ranges", { ...base, requires: ["org.example.base"] }],
    ["a requires range that is not semver", { ...base, requires: { "org.example.base": "soon" } }],
    ["an engines.platform that is not a range", { ...base, engines: { platform: "latest!" } }],
  ])("refuses a manifest with %s", async (_label, manifest) => {
    const { kernel, slots } = newKernel();
    const [refusal] = await refusals(kernel.install([archive(manifest)]));
    expect(refusal).toMatchObject({ code: "invalid-manifest" });
    expect(refusal?.message).toMatch(/\S/);
    expect(ids(slots.getSnapshot(installedFragmentsSlot))).toEqual([]);
  });

  it("refuses a fragment.jsonc that does not parse", async () => {
    const { kernel } = newKernel();
    const [refusal] = await refusals(kernel.install([{ "fragment.jsonc": "{ id: " }]));
    expect(refusal).toMatchObject({ code: "invalid-manifest" });
  });

  it("refuses an archive without a fragment.jsonc", async () => {
    const { kernel } = newKernel();
    const [refusal] = await refusals(kernel.install([{ "wrangler.jsonc": "{}" }]));
    expect(refusal).toMatchObject({ code: "invalid-manifest" });
  });

  it("refuses a $schema of an unknown manifest version", async () => {
    const { kernel } = newKernel();
    const text = JSON.stringify({
      ...base,
      $schema: "https://example.org/fragment.v9.schema.json",
    });
    const [refusal] = await refusals(kernel.install([{ "fragment.jsonc": text }]));
    expect(refusal).toMatchObject({ code: "invalid-manifest" });
    expect(refusal?.message).toContain("fragment.v9.schema.json");
  });

  it("refuses an engines.platform range that excludes this platform", async () => {
    const { kernel, slots } = newKernel({ platform: { version: "1.4.0", bindings: [] } });
    const [refusal] = await refusals(
      kernel.install([archive({ ...base, engines: { platform: "^2.0.0" } })]),
    );
    expect(refusal).toMatchObject({ id: "org.example.notes", code: "incompatible-platform" });
    expect(refusal?.message).toContain("1.4.0");
    expect(refusal?.message).toContain("^2.0.0");
    expect(ids(slots.getSnapshot(installedFragmentsSlot))).toEqual([]);
  });

  it("refuses a required binding the host lacks, and accepts the ones it has", async () => {
    const { kernel, slots } = newKernel({ platform: { version: "1.0.0", bindings: ["kv"] } });
    const [refusal] = await refusals(
      kernel.install([archive({ ...base, bindings: ["kv", "durable-objects"] })]),
    );
    expect(refusal).toMatchObject({ id: "org.example.notes", code: "missing-binding" });
    expect(refusal?.message).toContain("durable-objects");

    await kernel.install([archive({ ...base, bindings: ["kv"] })]);
    expect(ids(slots.getSnapshot(installedFragmentsSlot))).toEqual(["org.example.notes"]);
  });

  it("refuses a requires range the installed fragment's version does not meet", async () => {
    const { kernel, slots } = newKernel();
    await kernel.install([archive({ ...base, id: "org.example.base", version: "1.5.0" })]);
    const [refusal] = await refusals(
      kernel.install([archive({ ...base, requires: { "org.example.base": "^2.0.0" } })]),
    );
    expect(refusal).toMatchObject({ id: "org.example.notes", code: "unmet-requirement" });
    expect(refusal?.message).toContain("org.example.base");
    expect(refusal?.message).toContain("1.5.0");
    expect(ids(slots.getSnapshot(installedFragmentsSlot))).toEqual(["org.example.base"]);
  });

  it("refuses a required fragment that is neither installed nor in the same install", async () => {
    const { kernel } = newKernel();
    const [refusal] = await refusals(
      kernel.install([archive({ ...base, requires: { "org.example.base": "^1.0.0" } })]),
    );
    expect(refusal).toMatchObject({ id: "org.example.notes", code: "unmet-requirement" });
    expect(refusal?.message).toContain("not installed");
  });

  it("installs a fragment together with the fragment it requires", async () => {
    const { kernel, slots } = newKernel();
    await kernel.install([
      archive({ ...base, requires: { "org.example.base": "^1.0.0" } }),
      archive({ ...base, id: "org.example.base", version: "1.2.0" }),
    ]);
    expect(ids(slots.getSnapshot(installedFragmentsSlot)).sort()).toEqual([
      "org.example.base",
      "org.example.notes",
    ]);
  });

  it("installs all or nothing: one refused fragment refuses the whole install", async () => {
    const { kernel, slots } = newKernel();
    const [refusal] = await refusals(
      kernel.install([
        archive({ ...base, id: "org.example.base" }),
        archive({ ...base, engines: { platform: "^9.0.0" } }),
      ]),
    );
    expect(refusal).toMatchObject({ id: "org.example.notes", code: "incompatible-platform" });
    expect(ids(slots.getSnapshot(installedFragmentsSlot))).toEqual([]);
  });

  it("refuses a second version of an installed fragment (one version per host)", async () => {
    const { kernel } = newKernel();
    await kernel.install([archive(base)]);
    const [refusal] = await refusals(kernel.install([archive({ ...base, version: "1.1.0" })]));
    expect(refusal).toMatchObject({ id: "org.example.notes", code: "already-installed" });
  });
});

describe("check", () => {
  it("gives the refusals an install would raise, installing nothing", async () => {
    const { kernel, slots } = newKernel();
    const archives = [
      archive({ ...base, id: "system.evil" }),
      archive({ ...base, requires: { "org.example.base": "^1.0.0" } }),
    ];
    const checked = await kernel.check(archives);
    expect(checked.map((r) => r.code).sort()).toEqual(["reserved-id", "unmet-requirement"]);
    expect(ids(slots.getSnapshot(installedFragmentsSlot))).toEqual([]);
    expect(await refusals(kernel.install(archives))).toEqual(checked);
  });

  it("is empty when the install would go through", async () => {
    const { kernel, slots } = newKernel();
    expect(await kernel.check([archive(base)])).toEqual([]);
    expect(ids(slots.getSnapshot(installedFragmentsSlot))).toEqual([]);
  });
});

describe("code references stay inside the fragment (statewalker/statewalker-kernel#72)", () => {
  const withModule = (module: string) =>
    archive({
      ...base,
      aspects: {
        client: {
          extensions: [{ point: "views", data: { id: "v" }, reference: { module } }],
        },
      },
    });

  it.each([
    "data:text/javascript,export default 1",
    "https://attacker.example/x.js",
    "//attacker.example/x.js",
    "/x.js",
    "\\x.js",
    "../x.js",
    "./../x.js",
    "a/../../x.js",
    "a//x.js",
    ".hidden.js",
    "%2e%2e/x.js",
  ])("refuses a module reference %s", async (module) => {
    const { kernel, slots } = newKernel();
    const refused = await kernel.check([withModule(module)]);
    expect(refused).toHaveLength(1);
    await expect(kernel.install([withModule(module)])).rejects.toBeInstanceOf(FragmentInstallError);
    expect(ids(slots.getSnapshot(installedFragmentsSlot))).toEqual([]);
  });

  it.each(["../client", "/srv", "https://x/", "a/../b"])(
    "refuses an aspect dir %s",
    async (dir) => {
      const { kernel } = newKernel();
      const refused = await kernel.check([archive({ ...base, aspects: { client: { dir } } })]);
      expect(refused.map((r) => r.code)).toEqual(["invalid-manifest"]);
    },
  );

  it.each(["./index.js", "index.js", "chunks/view-1.2.js", "@scope/x.js"])(
    "accepts a module reference %s",
    async (module) => {
      const { kernel } = newKernel();
      expect(await kernel.check([withModule(module)])).toEqual([]);
    },
  );
});
