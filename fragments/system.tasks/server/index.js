// The server half of system.tasks (statewalker/statewalker-root#409): its fragment DO holds the
// host's task queue in its SQL storage (`ctx.storage.sql` is the queue's `SqlLike`), so tasks and
// job logs outlive the page and the host's restarts. The client half (src/tasks.ts) reaches it
// through `remoteQueueStore`:
//
//   POST /queue <operation>  → 200 { value }   the operation's answer (src/store.ts)
//                            → 400 { error, code? }   an operation the store does not name, or
//                                                     refused by the queue (`ECANCELED`, ...)
//
// The fragment hosts route `/fragments/system.tasks/<path>` to the object at
// `idFromName("system.tasks")`; the Worker's own fetch does the same under `wrangler dev`.
import { DurableObject } from "cloudflare:workers";
import { queueErrorToData, serveQueueStore, sqlQueueStore } from "../src/store.ts";

const ID = "system.tasks";
const PREFIX = `/fragments/${ID}`;
/** The largest operation taken: a 64 KB payload as JSON, with room for its envelope. */
const MAX_BODY = 256 * 1024;
/** The longest a long poll (`waitChange`, `waitJob`, `changes`) holds a request. */
const MAX_WAIT_MS = 60_000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

/** An operation's waits capped: a client cannot hold the DO's requests for longer. */
function capWaits(operation) {
  if (!operation || !Array.isArray(operation.args)) return operation;
  const args = operation.args.map((a) => a);
  if (operation.method === "waitChange" && typeof args[2] === "number")
    args[2] = Math.min(Math.max(args[2], 0), MAX_WAIT_MS);
  for (const [i, a] of args.entries())
    if (a && typeof a === "object" && !Array.isArray(a) && typeof a.wait_ms === "number")
      args[i] = { ...a, wait_ms: Math.min(Math.max(a.wait_ms, 0), MAX_WAIT_MS) };
  return { ...operation, args };
}

export class TasksFragment extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.serve = serveQueueStore(sqlQueueStore(ctx.storage.sql));
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname !== "/queue") return json({ error: "not found" }, 404);
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
    // Only the app's own pages: a JSON body (a cross-origin page cannot send one without a
    // preflight, which is never answered), and no request a browser marks as from another site.
    // An operation names its principal, so a request from elsewhere could publish as the user.
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json")
      return json({ error: "an operation is sent as application/json" }, 415);
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none")
      return json({ error: "only the app's own pages reach the queue" }, 403);
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > MAX_BODY) return json({ error: "the operation is too large" }, 413);
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ error: "the operation is too large" }, 413);
    let operation;
    try {
      operation = JSON.parse(text);
    } catch {
      return json({ error: "the body is not JSON" }, 400);
    }
    try {
      const value = await this.serve(capWaits(operation));
      return json(value === undefined ? {} : { value });
    } catch (error) {
      // The queue's code goes back with the message: a runner tells a cancellation by it.
      return json(queueErrorToData(error), 400);
    }
  }
}

/**
 * Under `wrangler dev` behind the app's launch server (apps/notes/scripts/launch.mjs), a request
 * is taken only as it forwarded it: with the launch's secret (`LAUNCH_SECRET`), so a page that
 * finds this Worker's own port reaches no DO. Deployed, the variable is unset and nothing is
 * checked here (statewalker/statewalker-kernel#78).
 */
function fromLaunch(request, env) {
  const secret = env.LAUNCH_SECRET;
  return !secret || request.headers.get("x-launch-secret") === secret;
}

export default {
  /** `/fragments/system.tasks/<path>` → the fragment DO at `/<path>` (wrangler dev). */
  async fetch(request, env) {
    if (!fromLaunch(request, env))
      return json({ error: "this Worker answers only its launch server" }, 403);
    const url = new URL(request.url);
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`))
      return json({ error: "not found" }, 404);
    const forwarded = new URL(url.pathname.slice(PREFIX.length) || "/", url);
    forwarded.search = url.search;
    const inner = new Request(forwarded, request);
    inner.headers.delete("x-launch-secret");
    return env.FRAGMENT.getByName(ID).fetch(inner);
  },
};
