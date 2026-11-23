import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { archiveHash, createMemoryArchiveStore, installedFragmentsSlot } from "../src/index.js";
import { archive, fragment, newKernel } from "./helpers.js";

describe("the content-addressed archive store", () => {
  it("hashes an archive as SHA-256 over its files sorted by name, whatever their order", async () => {
    const files = { "fragment.jsonc": "{}", "a.txt": "é" };
    // The canonical form: [[name, text], ...] sorted by name, as JSON, in UTF-8.
    const expected = createHash("sha256")
      .update(
        JSON.stringify([
          ["a.txt", "é"],
          ["fragment.jsonc", "{}"],
        ]),
        "utf8",
      )
      .digest("hex");
    expect(await archiveHash(files)).toBe(`sha256:${expected}`);
    expect(await archiveHash({ "a.txt": "é", "fragment.jsonc": "{}" })).toBe(`sha256:${expected}`);
    expect(await archiveHash({ "a.txt": "e", "fragment.jsonc": "{}" })).not.toBe(
      `sha256:${expected}`,
    );
  });

  it("stores every installed archive under its hash, which the installed fragment carries", async () => {
    const archives = createMemoryArchiveStore();
    const { kernel, slots } = newKernel({ archives });
    const files = archive(fragment("org.example.a"));
    await kernel.install([files]);
    const installed = slots.get(installedFragmentsSlot, "org.example.a");
    const hash = await archiveHash(files);
    expect(installed?.archive).toBe(hash);
    expect(await archives.get(hash)).toEqual(files);
  });

  it("keeps an archive immutable: what was stored under a hash is what is read back", async () => {
    const archives = createMemoryArchiveStore();
    const files: Record<string, string> = { "fragment.jsonc": "{}" };
    const hash = await archiveHash(files);
    await archives.put(hash, files);
    files["fragment.jsonc"] = "changed";
    expect(await archives.get(hash)).toEqual({ "fragment.jsonc": "{}" });
    await expect(archives.put(hash, { "fragment.jsonc": "other" })).rejects.toThrow(/hash/);
  });
});
