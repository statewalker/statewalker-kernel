import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/cli.js";
import { copyFixture } from "./helpers.js";

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    streams: { stdout: (s: string) => out.push(s), stderr: (s: string) => err.push(s) },
  };
}

describe("fragment-build", () => {
  it("builds a folder and prints the archive's hash and path", async () => {
    const dir = await copyFixture("counter");
    const out = join(dir, "out");
    const { out: printed, streams } = io();
    expect(await main([dir, "--out", out], streams)).toBe(0);
    const path = join(out, "org.example.counter-1.0.0.fragment.json");
    expect(existsSync(path)).toBe(true);
    expect(printed.join("")).toMatch(new RegExp(`^sha256:[0-9a-f]{64} ${path}\\n$`));
  });

  it("only generates the files with `generate`", async () => {
    const dir = await copyFixture("counter");
    const { streams } = io();
    expect(await main(["generate", dir], streams)).toBe(0);
    expect(existsSync(join(dir, "wrangler.jsonc"))).toBe(true);
    expect(existsSync(join(dir, "dist"))).toBe(false);
  });

  it("fails with a message and usage on bad arguments", async () => {
    const { err, streams } = io();
    expect(await main([], streams)).toBe(2);
    expect(err.join("")).toMatch(/usage: fragment-build/);
    const failed = io();
    expect(await main(["/nonexistent/fragment"], failed.streams)).toBe(1);
    expect(failed.err.join("")).toMatch(/^fragment-build: \/nonexistent\/fragment does not exist/);
  });
});
