// A static file server for the built app (`dist/`): what `pnpm start` and the browser tests use.
// No dependencies; files only, with the content types the app needs.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { Readable } from "node:stream";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonc": "application/jsonc; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

/**
 * The Node request as a web `Request` (its body streamed).
 * @param {import("node:http").IncomingMessage} request
 * @returns {Request}
 */
function toRequest(request) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else if (value !== undefined) headers.set(name, value);
  }
  const method = request.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(request);
  return new Request(new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`), {
    method,
    headers,
    body,
    duplex: "half",
  });
}

/**
 * A web `Response` written to the Node response.
 * @param {Response} answer
 * @param {import("node:http").ServerResponse} response
 */
async function send(answer, response) {
  const headers = {};
  for (const [name, value] of answer.headers) headers[name] = value;
  const cookies = answer.headers.getSetCookie?.() ?? [];
  if (cookies.length) headers["set-cookie"] = cookies;
  response.writeHead(answer.status, headers);
  if (answer.body) for await (const chunk of answer.body) response.write(chunk);
  response.end();
}

/**
 * Serve `root` on `port` (0: any free port) of 127.0.0.1.
 *
 * `options.launch`: served as `/launch.json` instead of the built file (which launch configuration
 * the page runs). `options.handle`: asked first for every request (a web `Request`); its `Response`
 * is the answer, `undefined` leaves the request to the files.
 * @param {string} root
 * @param {number} [port]
 * @param {{ launch?: object; handle?: (request: Request) => Promise<Response | undefined> }} [options]
 * @returns {Promise<{ url: string; close(): Promise<void> }>}
 */
export async function serveStatic(root, port = 0, options = {}) {
  const base = resolve(root);
  const server = createServer(async (request, response) => {
    if (options.handle) {
      try {
        const answer = await options.handle(toRequest(request));
        if (answer) return await send(answer, response);
      } catch (error) {
        if (!response.headersSent) response.writeHead(500, { "content-type": "text/plain" });
        return response.end(String(error?.stack ?? error));
      }
    }
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    if (options.launch && path === "/launch.json") {
      const body = JSON.stringify(options.launch);
      response.writeHead(200, {
        "content-type": TYPES[".json"],
        "content-length": Buffer.byteLength(body),
        "cache-control": "no-store",
      });
      return response.end(body);
    }
    const file = normalize(join(base, path.endsWith("/") ? `${path}index.html` : path));
    if (file !== base && !file.startsWith(base + sep)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new Error("not a file");
      response.writeHead(200, {
        "content-type": TYPES[extname(file)] ?? "application/octet-stream",
        "content-length": info.size,
        "cache-control": "no-store",
      });
      createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404, { "content-type": "text/plain" }).end("not found");
    }
  });
  await new Promise((done) => server.listen(port, "127.0.0.1", () => done(undefined)));
  const address = server.address();
  const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : port}/`;
  return {
    url,
    close: () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done(undefined));
      }),
  };
}
