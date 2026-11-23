import { readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readArchive } from "@statewalker/fragment-build.core";
import { createKernel } from "@statewalker/kernel.core";
import {
  createSystemCommands,
  SYSTEM_COMMANDS_ID,
  systemCommandsArchive,
} from "@statewalker/system.commands";
import { describe, expect, it } from "vitest";
import { buildFragment } from "../src/index.js";
import { copyFixture } from "./helpers.js";

async function install(files: Record<string, string>) {
  const system = createSystemCommands();
  const kernel = createKernel({
    platform: { version: "1.0.0", bindings: ["durable-objects"] },
    core: [systemCommandsArchive],
    activators: {
      client: (f, context) => (f.id === SYSTEM_COMMANDS_ID ? system.activate(context) : undefined),
    },
  });
  await kernel.start();
  const installed = await kernel.install([files]);
  for (const f of installed) await kernel.enable(f.id);
  await kernel.activate("client");
  return { installed, bus: system.bus };
}

describe("buildFragment", () => {
  it("generates the files from fragment.config.ts and packs an archive the kernel installs", async () => {
    const dir = await copyFixture("counter");
    const result = await buildFragment(dir);
    expect(result.id).toBe("org.example.counter");
    expect(result.path).toBe(join(dir, "dist", "org.example.counter-1.0.0.fragment.json"));
    expect(Object.keys(result.archive.files)).toEqual([
      "client/index.js",
      "fragment.client.jsonc",
      "fragment.jsonc",
      "openapi.json",
      "server/index.ts",
      "wrangler.jsonc",
    ]);
    // The generated files are written beside the config.
    expect(await readFile(join(dir, "wrangler.jsonc"), "utf8")).toBe(
      result.archive.files["wrangler.jsonc"],
    );
    const files = await readArchive(await readFile(result.path, "utf8"));
    expect(files).toEqual(result.archive.files);
    const { installed, bus } = await install(files);
    expect(installed.map((f) => f.id)).toEqual(["org.example.counter"]);
    expect(bus.list().map((c) => c.id)).toEqual(["org.example.counter/increment"]);
  });

  it("gives the same hash for the same sources, wherever and whenever they are built", async () => {
    const one = await copyFixture("counter");
    const two = await copyFixture("counter");
    const first = await buildFragment(one);
    await utimes(join(two, "server", "index.ts"), new Date(0), new Date(0));
    const second = await buildFragment(two);
    const again = await buildFragment(one);
    expect(second.hash).toBe(first.hash);
    expect(again.hash).toBe(first.hash);
    expect(await readFile(second.path, "utf8")).toBe(await readFile(first.path, "utf8"));
    expect(first.hash).toMatch(/^sha256:[0-9a-f]{64}$/);

    await writeFile(join(two, "server", "index.ts"), "export default {};\n");
    expect((await buildFragment(two)).hash).not.toBe(first.hash);
  });

  it("packs a hand-written folder (no fragment.config.ts) as it is", async () => {
    const dir = await copyFixture("counter");
    await buildFragment(dir);
    await rm(join(dir, "fragment.config.ts"));
    const result = await buildFragment(dir);
    expect(result.generated).toBe(false);
    expect(Object.keys(result.archive.files)).toContain("fragment.jsonc");
    expect(await stat(join(dir, "fragment.jsonc"))).toBeTruthy();
  });

  it("refuses a file that is not UTF-8 text, naming it", async () => {
    const dir = await copyFixture("counter");
    await writeFile(
      join(dir, "client", "logo.png"),
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe]),
    );
    await expect(buildFragment(dir)).rejects.toThrow(/client\/logo\.png.*text/);
  });
});
