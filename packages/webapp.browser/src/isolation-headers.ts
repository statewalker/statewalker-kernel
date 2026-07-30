// Cross-origin isolation header stamping (webapp-browser-host R2).
//
// The hosted client is embedded in a cross-origin-isolated iframe, so every
// response the ServiceWorker serves must carry `Cross-Origin-Embedder-Policy`
// + `Cross-Origin-Resource-Policy` (the notes-demo / duckdb-demo pattern). This
// is a pure `SiteHandler → SiteHandler` decorator, unit-testable in node with no
// ServiceWorker involved.

/** A site request handler — mirrors `@statewalker/webrun-site-builder`'s `SiteHandler`. */
export type SiteHandler = (request: Request) => Promise<Response>;

/**
 * Wrap `handler` so every response it produces carries the cross-origin
 * isolation headers required to embed the hosted client in a
 * cross-origin-isolated iframe:
 * - `Cross-Origin-Embedder-Policy: credentialless`
 * - `Cross-Origin-Resource-Policy: cross-origin`
 *
 * The response body is streamed through unchanged; only the headers are
 * augmented (a fresh `Headers` copy, so the source response is untouched).
 */
export function withIsolationHeaders(handler: SiteHandler): SiteHandler {
  return async (request: Request): Promise<Response> => {
    const res = await handler(request);
    const headers = new Headers(res.headers);
    headers.set("Cross-Origin-Embedder-Policy", "credentialless");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    return new Response(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers,
    });
  };
}
