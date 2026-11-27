// The server half of the notes fragment (statewalker/statewalker-root#259): its fragment DO keeps the
// notes in SQLite.
//
//   GET  /notes          → 200 { notes: [{ id, text, at }] }, oldest first
//   POST /notes { text } → 201 { id, text, at, count }
//   DELETE /notes/<id>   → 200 { id }, or 404
//
// The fragment hosts route `/fragments/org.statewalker.notes/<path>` to the object at
// `idFromName("org.statewalker.notes")` themselves; the Worker's own fetch does the same, so that
// `wrangler dev` serves the same paths.
import { DurableObject } from "cloudflare:workers";

const ID = "org.statewalker.notes";
const PREFIX = `/fragments/${ID}`;
/** The longest note kept, in characters. */
const MAX_TEXT = 10_000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export class NotesFragment extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, at INTEGER NOT NULL)",
    );
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);
    const one = /^\/notes\/(\d+)$/.exec(pathname);
    if (one) {
      if (request.method !== "DELETE") return json({ error: "method not allowed" }, 405);
      const id = Number(one[1]);
      const removed = this.ctx.storage.sql
        .exec("DELETE FROM notes WHERE id = ? RETURNING id", id)
        .toArray();
      return removed.length ? json({ id }) : json({ error: "no such note" }, 404);
    }
    if (pathname !== "/notes") return json({ error: "not found" }, 404);
    if (request.method === "GET") {
      const notes = this.ctx.storage.sql
        .exec("SELECT id, text, at FROM notes ORDER BY id")
        .toArray();
      return json({ notes });
    }
    if (request.method === "POST") {
      let text;
      try {
        ({ text } = await request.json());
      } catch {
        return json({ error: "the body is not JSON" }, 400);
      }
      if (typeof text !== "string" || text.trim() === "" || text.length > MAX_TEXT)
        return json(
          { error: `text must be a non-empty string of at most ${MAX_TEXT} characters` },
          400,
        );
      const at = Date.now();
      const [row] = this.ctx.storage.sql
        .exec("INSERT INTO notes (text, at) VALUES (?, ?) RETURNING id", text, at)
        .toArray();
      const [{ count }] = this.ctx.storage.sql
        .exec("SELECT count(*) AS count FROM notes")
        .toArray();
      return json({ id: row.id, text, at, count }, 201);
    }
    return json({ error: "method not allowed" }, 405);
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
  /** `/fragments/org.statewalker.notes/<path>` → the fragment DO at `/<path>` (wrangler dev). */
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
