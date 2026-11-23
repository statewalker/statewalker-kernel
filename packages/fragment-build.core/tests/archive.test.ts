import { createHash } from "node:crypto";
import { archiveHash } from "@statewalker/kernel.core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineFragment,
  generateFragmentFiles,
  packArchive,
  readArchive,
  serializeArchive,
} from "../src/index.js";
import { platform } from "./helpers.js";

const ID = "org.example.greeter";

const config = defineFragment({
  id: ID,
  version: "1.0.0",
  engines: { platform: "^1.0.0" },
  client: {},
  commands: {
    greet: {
      input: z.object({ name: z.string() }),
      handler: { module: "./commands.js", export: "greet" },
    },
  },
});

const sources = {
  ...generateFragmentFiles(config),
  "client/commands.js": "export const greet = ({ name }) => ({ text: 'hi ' + name });\n",
};

describe("archiveHash (kernel.core) over packed files", () => {
  it("is SHA-256 over the files sorted by path, as JSON [[path, text], ...]", async () => {
    const files = { "b.txt": "B", "a/x.js": "x", "fragment.jsonc": "{}" };
    const expected = createHash("sha256")
      .update(
        JSON.stringify([
          ["a/x.js", "x"],
          ["b.txt", "B"],
          ["fragment.jsonc", "{}"],
        ]),
      )
      .digest("hex");
    expect(await archiveHash(files)).toBe(`sha256:${expected}`);
  });

  it("does not depend on the order files were read in, and changes with any byte", async () => {
    const reversed = Object.fromEntries(Object.entries(sources).reverse());
    expect(await archiveHash(reversed)).toBe(await archiveHash(sources));
    const changed = { ...sources, "client/commands.js": `${sources["client/commands.js"]} ` };
    expect(await archiveHash(changed)).not.toBe(await archiveHash(sources));
  });
});

describe("archives", () => {
  it("pack the same sources twice into the same bytes and hash", async () => {
    const one = await packArchive(sources);
    const two = await packArchive(Object.fromEntries(Object.entries(sources).reverse()));
    expect(two.hash).toBe(one.hash);
    expect(serializeArchive(two)).toBe(serializeArchive(one));
  });

  it("are installed by the kernel as read, with no build step", async () => {
    const text = serializeArchive(await packArchive(sources));
    const files = await readArchive(text);
    expect(files).toEqual(sources);
    const { bus } = await platform([files], {
      [ID]: { greet: ({ name }: { name: string }) => ({ text: `hi ${name}` }) },
    });
    await expect(bus.call(`${ID}/greet`, { name: "ann" })).resolves.toEqual({ text: "hi ann" });
  });

  it("are refused when their files do not match their hash", async () => {
    const archive = JSON.parse(serializeArchive(await packArchive(sources)));
    archive.files["client/commands.js"] = "export const greet = () => 'evil';\n";
    await expect(readArchive(JSON.stringify(archive))).rejects.toThrow(/hash/);
  });

  it("are refused with an unknown $schema version", async () => {
    const archive = JSON.parse(serializeArchive(await packArchive(sources)));
    archive.$schema = "https://example.org/fragment-archive.v2.schema.json";
    await expect(readArchive(JSON.stringify(archive))).rejects.toThrow(/schema/);
  });

  it("refuse paths that could leave the fragment's folder", async () => {
    for (const path of [
      "../x.js",
      "/etc/passwd",
      "a/../../x",
      "a\\b.js",
      "a//b.js",
      "./a.js",
      "",
    ]) {
      await expect(packArchive({ ...sources, [path]: "x" })).rejects.toThrow(/path/);
    }
  });
});
