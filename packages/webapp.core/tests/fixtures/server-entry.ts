import type { FilesApi } from "@statewalker/webrun-files";
import { readText } from "@statewalker/webrun-files";

/**
 * A stand-in for a built `server/index.ts`: a `(request, env)` default export that
 * reads its persistent context from the injected `env` (D5). Used to prove the server
 * contract directly in node — the hosted `/api/*` path (dynamic `import()`) is proven
 * in the browser E2E, since node has no resolvable module URL without a host.
 */
export default async function handler(
  _request: Request,
  env: { data: FilesApi },
): Promise<Response> {
  const message = await readText(env.data, "/message.txt");
  return new Response(message, { status: 200 });
}
