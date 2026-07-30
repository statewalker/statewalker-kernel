import { writeText } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it } from "vitest";
import { deriveLock, NonExactVersionError, toExactVersion } from "../src/derive-lock.js";

// Hermetic: `deriveLock` is pure over `package.json` — no network, no resolution.
describe("deriveLock", () => {
  it("accepts an exact x.y.z version (with optional prerelease/build)", () => {
    expect(toExactVersion("18.3.1")).toBe("18.3.1");
    expect(toExactVersion("4.9.0")).toBe("4.9.0");
    expect(toExactVersion("1.2.3-beta.1")).toBe("1.2.3-beta.1");
  });

  it("rejects every non-exact form with a clear typed error (no network resolution)", () => {
    for (const bad of [
      "^18.3.1",
      "~4.9.0",
      ">=2.0.0",
      "18",
      "18.x",
      "latest",
      "workspace:*",
      "file:../x",
      "npm:alias@1",
    ]) {
      expect(() => toExactVersion(bad)).toThrow(NonExactVersionError);
    }
  });

  it("pins every declared (exact) dependency", async () => {
    const files = new MemFilesApi();
    await writeText(
      files,
      "/package.json",
      JSON.stringify({ name: "app", dependencies: { react: "18.3.1", zod: "3.23.0" } }),
    );

    expect(await deriveLock(files)).toEqual({ react: "18.3.1", zod: "3.23.0" });
  });

  it("rejects a non-exact dependency, naming the offending entry", async () => {
    const files = new MemFilesApi();
    await writeText(
      files,
      "/package.json",
      JSON.stringify({ name: "app", dependencies: { react: "^18.3.1" } }),
    );

    await expect(deriveLock(files)).rejects.toThrow(/react/);
  });

  it("yields an empty lock when there are no dependencies", async () => {
    const files = new MemFilesApi();
    await writeText(files, "/package.json", JSON.stringify({ name: "app" }));

    expect(await deriveLock(files)).toEqual({});
  });
});
