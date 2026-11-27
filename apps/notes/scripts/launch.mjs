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
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { parseJsonc } from "@statewalker/kernel.core";
import { coreServerFragments } from "./core-fragments.mjs";
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

/**
 * The fragments whose server halves a server host runs: the platform's core ones
 * (scripts/core-fragments.mjs), then the app's own.
 */
export function serverFragments() {
  return [...coreServerFragments().map(({ id, dir }) => ({ id, dir })), ...appServerFragments()];
}

/** The app's fragments that have a server half: their id and source folder. */
function appServerFragments() {
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

/** The names this host answers to: it listens on the loopback address only. */
const LOCAL_NAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * A request to a server half from anywhere but this app's pages: one a browser says comes from
 * another site (`Sec-Fetch-Site`), or one addressed to another name (`Host`: a page of a domain
 * rebound to 127.0.0.1 is same-origin to itself). The fragments' DOs trust the app's pages only.
 */
function fromElsewhere(request) {
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") return true;
  const host = request.headers.get("host") ?? "";
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return !LOCAL_NAMES.has((name ?? "").toLowerCase());
}

/**
 * The body types a page of another origin can POST without a preflight (CORS-safelisted), and no
 * type at all (a no-cors Blob without one): a server half never takes them, so a site elsewhere
 * cannot write to a DO even in a browser that sends no `Sec-Fetch-Site`
 * (statewalker/statewalker-kernel#76). JSON, and any other type, needs a preflight, never answered.
 */
const SIMPLE_TYPES = new Set([
  "",
  "text/plain",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
]);

/** A POST another site could have sent without a preflight. */
function simplePost(request) {
  if (request.method !== "POST") return false;
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  return SIMPLE_TYPES.has(type);
}

const refusedSimple = () =>
  new Response("a server half takes a POST as JSON (or another type a preflight guards)", {
    status: 415,
    headers: { "content-type": "text/plain" },
  });

const refusedElsewhere = () =>
  new Response("the fragments' server halves answer only this app's pages", {
    status: 403,
    headers: { "content-type": "text/plain" },
  });

/**
 * `POST /_launch/fragments/<id>/data/remove`: "remove with data" of a fragment's server half on
 * this host (statewalker/statewalker-kernel#73), the shell's `removeServerData` in the `server`
 * launch configuration. Its DO storage is deleted and the server half starts again empty, ready
 * for a reinstall. Answers the fragment's id, or the refusal.
 */
const REMOVE_DATA = /^\/_launch\/fragments\/([^/]+)\/data\/remove$/;

/** The fragment a "remove with data" request names, or undefined for any other request. */
function removeDataOf(request) {
  const match = REMOVE_DATA.exec(new URL(request.url).pathname);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

/** `run(id)`, one call at a time per id: a call waits for the one before it, whatever its end. */
function oneAtATime(run) {
  const last = new Map();
  return (id) => {
    const next = (last.get(id) ?? Promise.resolve()).then(() => run(id));
    const settled = next.catch(() => {});
    last.set(id, settled);
    void settled.then(() => {
      if (last.get(id) === settled) last.delete(id);
    });
    return next;
  };
}

/** Runs a "remove with data" request with `remove(id)`, as the app's own pages may ask it. */
async function answerRemoveData(request, id, known, remove) {
  if (fromElsewhere(request)) return refusedElsewhere();
  if (request.method !== "POST")
    return new Response("method not allowed", { status: 405, headers: { allow: "POST" } });
  if (simplePost(request)) return refusedSimple();
  if (!known(id))
    return new Response(`no fragment "${id}" on this host`, {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
  try {
    await remove(id);
    return Response.json({ removed: id });
  } catch (error) {
    return new Response(`${id}: its data was not removed: ${error?.message ?? error}`, {
      status: 500,
      headers: { "content-type": "text/plain" },
    });
  }
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
async function wranglerDev({ id, dir }, { persistTo, secret }) {
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
  // Its Worker takes only requests carrying this launch's secret (statewalker-kernel#78): its own
  // port, which a page could find, bypasses this server's checks otherwise.
  if (secret) args.push("--var", `LAUNCH_SECRET:${secret}`);
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
    const dirs = new Map(serverFragments().map(({ id, dir }) => [id, dir]));
    // Removed with its data, a server half comes back empty: the host serves every app fragment.
    // One at a time per fragment (a second add of the same id would be refused).
    const removeData = oneAtATime(async (id) => {
      await host.remove(id, { withData: true });
      await host.add(id, dirs.get(id));
    });
    for (const { id, dir } of serverFragments()) {
      const added = await host.add(id, dir);
      if (added.unsupported.length)
        console.warn(`${id}: unsupported: ${added.unsupported.join("; ")}`);
    }
    const server = await serveStatic(DIST, port, {
      launch: { fragments: "server", ...(peerId ? { peerId } : {}) },
      handle: async (request) => {
        const removing = removeDataOf(request);
        if (removing !== undefined)
          return answerRemoveData(request, removing, (id) => dirs.has(id), removeData);
        if (!fragmentOf(new URL(request.url).pathname, peerId)) return undefined;
        if (fromElsewhere(request)) return refusedElsewhere();
        return simplePost(request) ? refusedSimple() : host.fetch(request);
      },
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
    // Each server half's state where this launch can delete it ("remove with data"): under
    // `data`, else a folder of the app's own kept across runs (gitignored, as wrangler's default
    // in each fragment's source folder was; that one is no longer read).
    const state = data ?? join(ROOT, ".wrangler", "launch-state");
    /** What every forwarded request carries, and the Workers take nothing without. */
    const secret = randomUUID();
    const fragments = new Map(serverFragments().map((f) => [f.id, f]));
    // One at a time per fragment: two at once would each start a wrangler dev on the same
    // state, the first left running unreachable.
    const removeData = oneAtATime(async (id) => {
      await workers.get(id)?.close();
      workers.delete(id);
      rmSync(join(state, id), { recursive: true, force: true });
      workers.set(id, await wranglerDev(fragments.get(id), { persistTo: state, secret }));
    });
    const stopWorkers = async () => {
      for (const w of workers.values()) await w.close();
    };
    let server;
    try {
      for (const fragment of fragments.values())
        workers.set(fragment.id, await wranglerDev(fragment, { persistTo: state, secret }));
      server = await serveStatic(DIST, port, {
        launch: { fragments: "server", ...(peerId ? { peerId } : {}) },
        handle: async (request) => {
          const removing = removeDataOf(request);
          if (removing !== undefined)
            return answerRemoveData(request, removing, (id) => fragments.has(id), removeData);
          const url = new URL(request.url);
          const target = fragmentOf(url.pathname, peerId);
          if (!target) return undefined;
          if (fromElsewhere(request)) return refusedElsewhere();
          if (simplePost(request)) return refusedSimple();
          const worker = workers.get(target.id);
          if (!worker)
            return new Response(`no fragment "${target.id}" on this host`, {
              status: 404,
              headers: { "content-type": "text/plain" },
            });
          // Hop-by-hop headers are this connection's, not the next one's (fetch refuses some).
          const forwarded = new Headers(request.headers);
          for (const name of HOP_BY_HOP) forwarded.delete(name);
          forwarded.set("x-launch-secret", secret);
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
      /** Each server half's own `wrangler dev` address (for tests: it answers this server only). */
      workerBases: () => new Map([...workers].map(([id, w]) => [id, w.base])),
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
