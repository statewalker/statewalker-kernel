#!/usr/bin/env node
// The launch configurations of apps/notes (statewalker/statewalker-root#259): the built app (`dist/`,
// `pnpm run build` first) with its fragments' server halves served at `/fragments/{id}/…` by
//
//   browser   CellB in the page's origin: a ServiceWorker and a pool of shard workers the tabs
//             share (src/fragment-servers.ts); this server serves files only;
//   node      CellB on Node: one fragment host holding every server half (`createFragmentHost`),
//             its data under `--data` (memory by default); `/peers/<peer-id>/fragments/…` too;
//   wrangler  `wrangler dev`, one per server half, each fragment's Worker routing
//             `/fragments/<id>/…` to its fragment DO; this server forwards to it.
//
//   node scripts/launch.mjs <browser|node|wrangler> [--port 4173] [--data <dir>] [--peer-id <id>]
//
// `launch(mode, options)` is the same for the tests.
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { parseJsonc } from "@statewalker/kernel.core";
import { serveStatic } from "./static-server.mjs";

const ROOT = resolve(import.meta.dirname, "..");
/** Headers of one connection, never forwarded to the next (RFC 9110 §7.6.1), and `host`. */
const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "expect",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "host",
];
const DIST = join(ROOT, "dist");

/** The app's fragments that have a server half: their id and source folder. */
export function serverFragments() {
  const fragments = join(ROOT, "fragments");
  const found = [];
  for (const folder of readdirSync(fragments, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    const dir = join(fragments, folder.name);
    const manifest = parseJsonc(readFileSync(join(dir, "fragment.jsonc"), "utf8")).value;
    if (manifest.aspects?.server) found.push({ id: manifest.id, dir });
  }
  return found;
}

/** `/fragments/<id>/…`, or `/peers/<peerId>/fragments/<id>/…` naming this host: the fragment's. */
function fragmentOf(pathname, peerId) {
  let path = pathname;
  if (peerId !== undefined) {
    const self = `/peers/${encodeURIComponent(peerId)}/`;
    if (path.startsWith(self)) path = path.slice(self.length - 1);
  }
  const match = /^\/fragments\/([^/]+)(\/.*)?$/.exec(path);
  if (!match) return undefined;
  try {
    return { id: decodeURIComponent(match[1]), path };
  } catch {
    return undefined;
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((done) => server.listen(0, "127.0.0.1", () => done(undefined)));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  await new Promise((done) => server.close(() => done(undefined)));
  return port;
}

/** `wrangler dev` for one server half; resolves once it answers. */
async function wranglerDev({ id, dir }, { persistTo }) {
  const port = await freePort();
  const inspector = await freePort();
  const bin = join(ROOT, "node_modules", ".bin", "wrangler");
  const args = [
    "dev",
    "--port",
    String(port),
    "--inspector-port",
    String(inspector),
    "--ip",
    "127.0.0.1",
  ];
  if (persistTo) args.push("--persist-to", join(persistTo, id));
  // Its own process group (wrangler starts workerd as its children): stopped as a whole, and
  // whenever this process exits, however it exits.
  const child = spawn(bin, args, {
    cwd: dir,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const killGroup = (signal) => {
    try {
      process.kill(-(/** @type {number} */ (child.pid)), signal);
    } catch {
      // gone already
    }
  };
  const onExit = () => killGroup("SIGKILL");
  process.once("exit", onExit);
  child.once("exit", () => process.off("exit", onExit));
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; ; i++) {
    if (child.exitCode !== null)
      throw new Error(`wrangler dev for ${id} exited:\n${log.slice(-2000)}`);
    try {
      await fetch(`${base}/`);
      break;
    } catch {
      if (i > 600) {
        killGroup("SIGKILL");
        throw new Error(`wrangler dev for ${id} did not start:\n${log.slice(-2000)}`);
      }
      await new Promise((done) => setTimeout(done, 100));
    }
  }
  return {
    base,
    close: () =>
      new Promise((done) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          killGroup("SIGKILL"); // workerd may outlive wrangler
          return done(undefined);
        }
        child.once("exit", () => {
          killGroup("SIGKILL");
          done(undefined);
        });
        killGroup("SIGTERM");
        setTimeout(() => killGroup("SIGKILL"), 5_000).unref();
      }),
  };
}

/**
 * Serve the built app in a launch configuration.
 * @param {"browser" | "node" | "wrangler"} mode
 * @param {{ port?: number; data?: string; peerId?: string }} [options]
 */
export async function launch(mode, options = {}) {
  const { port = 0, data, peerId } = options;
  if (mode === "browser") {
    const server = await serveStatic(DIST, port, {
      launch: { fragments: "browser", ...(peerId ? { peerId } : {}) },
    });
    return { mode, url: server.url, close: () => server.close() };
  }
  if (mode === "node") {
    const { createFragmentHost } = await import("@statewalker/cellb/node");
    const host = createFragmentHost({ ...(data ? { data } : {}), ...(peerId ? { peerId } : {}) });
    for (const { id, dir } of serverFragments()) {
      const added = await host.add(id, dir);
      if (added.unsupported.length)
        console.warn(`${id}: unsupported: ${added.unsupported.join("; ")}`);
    }
    const server = await serveStatic(DIST, port, {
      launch: { fragments: "server", ...(peerId ? { peerId } : {}) },
      handle: async (request) =>
        fragmentOf(new URL(request.url).pathname, peerId) ? host.fetch(request) : undefined,
    });
    return {
      mode,
      url: server.url,
      host,
      async close() {
        await server.close();
        await host.close();
      },
    };
  }
  if (mode === "wrangler") {
    const workers = new Map();
    const stopWorkers = async () => {
      for (const w of workers.values()) await w.close();
    };
    let server;
    try {
      for (const fragment of serverFragments())
        workers.set(fragment.id, await wranglerDev(fragment, { persistTo: data }));
      server = await serveStatic(DIST, port, {
        launch: { fragments: "server", ...(peerId ? { peerId } : {}) },
        handle: async (request) => {
          const url = new URL(request.url);
          const target = fragmentOf(url.pathname, peerId);
          if (!target) return undefined;
          const worker = workers.get(target.id);
          if (!worker)
            return new Response(`no fragment "${target.id}" on this host`, {
              status: 404,
              headers: { "content-type": "text/plain" },
            });
          // Hop-by-hop headers are this connection's, not the next one's (fetch refuses some).
          const forwarded = new Headers(request.headers);
          for (const name of HOP_BY_HOP) forwarded.delete(name);
          const answer = await fetch(`${worker.base}${target.path}${url.search}`, {
            method: request.method,
            headers: forwarded,
            body: request.body,
            duplex: "half",
            redirect: "manual",
          });
          // fetch has decoded the body already: its encoding and length no longer describe it.
          const headers = new Headers(answer.headers);
          headers.delete("content-encoding");
          headers.delete("content-length");
          return new Response(answer.body, {
            status: answer.status,
            statusText: answer.statusText,
            headers,
          });
        },
      });
    } catch (error) {
      await stopWorkers();
      throw error;
    }
    return {
      mode,
      url: server.url,
      async close() {
        await server.close();
        await stopWorkers();
      },
    };
  }
  throw new Error(`unknown launch configuration "${mode}": browser, node or wrangler`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [mode = "browser", ...rest] = process.argv.slice(2);
  const flag = (name) => {
    const i = rest.indexOf(`--${name}`);
    return i < 0 ? undefined : rest[i + 1];
  };
  const app = await launch(/** @type {"browser" | "node" | "wrangler"} */ (mode), {
    port: Number(flag("port") ?? process.env.PORT ?? 4173),
    data: flag("data"),
    peerId: flag("peer-id"),
  });
  console.log(`apps/notes (${app.mode}) on ${app.url}`);
  const stop = () => void app.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
