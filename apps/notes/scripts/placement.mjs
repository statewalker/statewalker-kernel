// Placement on a server host (statewalker/statewalker-root#263): what a Move of a fragment's server
// half asks of the host it leaves and of the host it goes to, under `/_launch/` (the `node` launch
// configuration). The page that moves a fragment (src/placement.ts) runs the steps; each host only
// does its own part:
//
//   GET  /_launch/host.json                         this host: its fragments, their versions and states
//   GET  /_launch/fragments/<id>/data               whether the fragment has data here
//   POST /_launch/fragments/<id>/install {version}  add it here, disabled, if this host offers that version
//   POST /_launch/fragments/<id>/disable | enable   stop it (503) or run it
//   POST /_launch/fragments/<id>/data/export {handOver, to}   its files; a hand-over keeps it from running
//   POST /_launch/fragments/<id>/data/import {files}          the files of another host, before it runs
//   POST /_launch/fragments/<id>/reactivate         a Move rolled back: it runs again on the data it kept
//   POST /_launch/fragments/<id>/data/delete        its data deleted, the fragment dropped from this host
//
// Files travel as `[path, base64]`. A move copies them without transforming them: the host it goes
// to must offer the same version of the fragment.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** `/_launch/host.json`, or `/_launch/fragments/<id>/<action>`: what a placement request names. */
const PLACEMENT =
  /^\/_launch\/(?:(host\.json)|fragments\/([^/]+)\/(data|install|disable|enable|reactivate|data\/export|data\/import|data\/delete))$/;

/** The placement request `request` is, or undefined for any other. */
export function placementOf(request) {
  const match = PLACEMENT.exec(new URL(request.url).pathname);
  if (!match) return undefined;
  if (match[1]) return { action: "host" };
  try {
    return { id: decodeURIComponent(match[2]), action: match[3] };
  } catch {
    return undefined;
  }
}

const text = (status, message) =>
  new Response(message, { status, headers: { "content-type": "text/plain" } });

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const unb64 = (s) => new Uint8Array(Buffer.from(s, "base64"));

/**
 * Answers a placement request for a fragment host.
 * @param {Request} request
 * @param {{ action: string; id?: string }} target
 * @param {{
 *   host: import("@statewalker/cellb/node").FragmentHost;
 *   offered: Map<string, { dir: string; version: string }>;
 *   serial: (id: string, run: () => Promise<Response>) => Promise<Response>;
 *   dataDir?: string;
 * }} context
 */
export async function answerPlacement(request, target, { host, offered, serial, dataDir }) {
  if (target.action === "host") {
    if (request.method !== "GET") return text(405, "method not allowed");
    return Response.json({
      runtime: "cellb-node",
      fragments: Object.fromEntries(
        host.ids().map((id) => [
          id,
          {
            state: host.state(id),
            version: offered.get(id)?.version,
            handedOver: host.handedOver(id) !== undefined,
          },
        ]),
      ),
      offered: Object.fromEntries([...offered].map(([id, { version }]) => [id, version])),
    });
  }
  const id = /** @type {string} */ (target.id);
  if (target.action === "data") {
    if (request.method !== "GET") return text(405, "method not allowed");
    // Read where the files lie, the fragment left running: whether any of its objects (not
    // CellB's own `__cellb_*` databases) has a database yet.
    const folder = dataDir === undefined ? undefined : join(dataDir, "fragments", id);
    if (!folder || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(id))
      return text(409, "this host keeps its data in memory");
    const cells = existsSync(folder)
      ? readdirSync(folder).filter((f) => f.endsWith(".sqlite") && !f.startsWith("__cellb"))
      : [];
    return Response.json({ id, hasData: cells.length > 0, cells: cells.length });
  }
  if (request.method !== "POST")
    return new Response("method not allowed", { status: 405, headers: { allow: "POST" } });
  /** @type {any} */
  let body = {};
  try {
    body = await request.json();
  } catch {
    return text(400, "the body is not JSON");
  }
  return serial(id, async () => {
    try {
      switch (target.action) {
        case "install": {
          const source = offered.get(id);
          if (!source) return text(404, `this host offers no fragment "${id}"`);
          if (body.version !== source.version)
            return text(
              409,
              `${id}: this host offers version ${source.version}, not ${body.version}: a Move copies data between equal versions only`,
            );
          if (host.state(id) !== undefined) return text(409, `${id} is already on this host`);
          if ((await host.exportData(id)).length > 0 || host.handedOver(id))
            return text(409, `${id} already has data on this host`);
          const added = await host.add(id, source.dir);
          if (added.unsupported.length > 0) {
            await host.remove(id, { withData: true });
            return text(
              422,
              `${id} needs what this host does not provide: ${added.unsupported.join("; ")}`,
            );
          }
          await host.disable(id);
          return Response.json({ installed: id, version: source.version });
        }
        case "disable":
          await host.disable(id);
          return Response.json({ id, state: host.state(id) });
        case "enable":
          await host.enable(id);
          return Response.json({ id, state: host.state(id) });
        case "data/export": {
          if (host.state(id) === "enabled") return text(409, `${id} runs: disable it first`);
          const handOver = body.handOver
            ? {
                at: new Date().toISOString(),
                ...(typeof body.to === "string" ? { to: body.to } : {}),
              }
            : undefined;
          const files = await host.exportData(id, { handOver });
          return Response.json({ id, files: files.map(([p, b]) => [p, b64(b)]) });
        }
        case "data/import": {
          if (!Array.isArray(body.files)) return text(400, "files: [path, base64][]");
          const files = body.files.map(([p, b]) => [String(p), unb64(String(b))]);
          // Over the fresh copy `install` made: only a host that had no data for it installs it.
          const report = await host.importData(id, files, { overwrite: true });
          return Response.json({ id, ...report });
        }
        case "reactivate":
          await host.reactivate(id);
          return Response.json({ id, state: host.state(id) });
        case "data/delete":
          await host.remove(id, { withData: true });
          return Response.json({ deleted: id });
        default:
          return text(404, "no such placement action");
      }
    } catch (error) {
      return text(409, `${id}: ${error?.message ?? error}`);
    }
  });
}
