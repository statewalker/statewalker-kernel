import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonc } from "@statewalker/kernel.core";
import { describe, expect, it } from "vitest";
import { systemTasksArchive } from "../src/index.js";

describe("the system.tasks fragment's folder", () => {
  it("ships the archive its folder holds", () => {
    const root = join(import.meta.dirname, "..");
    for (const file of ["fragment.jsonc", "fragment.client.jsonc", "wrangler.jsonc"]) {
      const onDisk = parseJsonc(readFileSync(join(root, file), "utf8")).value;
      expect(onDisk).toEqual(JSON.parse(systemTasksArchive[file] ?? "null"));
    }
  });
});
