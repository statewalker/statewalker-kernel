// A static file server for the built app (`dist/`): what `pnpm start` and the browser tests use.
// No dependencies; files only, with the content types the app needs.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsonc": "application/jsonc; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

/**
 * Serve `root` on `port` (0: any free port) of 127.0.0.1.
 * @param {string} root
 * @param {number} [port]
 * @returns {Promise<{ url: string; close(): Promise<void> }>}
 */
export async function serveStatic(root, port = 0) {
  const base = resolve(root);
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
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
