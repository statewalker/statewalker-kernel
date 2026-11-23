import { type ChildProcess, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { readArchive } from "@statewalker/fragment-build.core";
import { afterEach, describe, expect, it } from "vitest";
import { buildFragment } from "../src/index.js";
import { copyFixture } from "./helpers.js";

const WRANGLER = join(import.meta.dirname, "..", "node_modules", ".bin", "wrangler");

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

let child: ChildProcess | undefined;

afterEach(() => {
  // Detached: the negative pid ends wrangler and the workerd it started.
  if (child?.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
  }
  child = undefined;
});

/** Run `wrangler dev --local` in `cwd` until it says it is ready; resolve its URL. */
async function wranglerDev(cwd: string): Promise<string> {
  const port = await freePort();
  child = spawn(WRANGLER, ["dev", "--local", "--ip", "127.0.0.1", "--port", String(port)], {
    cwd,
    detached: true,
    env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" },
  });
  const proc = child;
  let log = "";
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      log += chunk.toString();
      if (/Ready on http/.test(log)) resolve(`http://127.0.0.1:${port}`);
    };
    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);
    proc.once("exit", (code) => reject(new Error(`wrangler dev exited with ${code}:\n${log}`)));
  });
}

describe("the generated wrangler.jsonc", () => {
  it("runs unchanged under `wrangler dev`, from the unpacked archive", async () => {
    const source = await copyFixture("counter");
    const { path } = await buildFragment(source);
    // Unpack the archive into a fresh folder: what a host gets, with no build step of ours.
    const target = await copyFixture("empty");
    const files = await readArchive(await readFile(path, "utf8"));
    for (const [name, text] of Object.entries(files)) {
      await mkdir(dirname(join(target, name)), { recursive: true });
      await writeFile(join(target, name), text);
    }
    const url = await wranglerDev(target);
    // The Durable Object binding and its sqlite migration are live.
    expect(await (await fetch(`${url}/?by=2`)).json()).toEqual({ value: 2 });
    expect(await (await fetch(`${url}/?by=3`)).json()).toEqual({ value: 5 });
  }, 120_000);
});
