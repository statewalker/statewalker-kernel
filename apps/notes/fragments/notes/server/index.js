// The server half of the notes fragment (statewalker/statewalker-root#259): its fragment DO keeps the
// notes in SQLite.
//
//   GET  /notes          → 200 { notes: [{ id, text, at }] }, oldest first
//   POST /notes { text } → 201 { id, text, at, count }
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

export default {
  /** `/fragments/org.statewalker.notes/<path>` → the fragment DO at `/<path>` (wrangler dev). */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`))
      return json({ error: "not found" }, 404);
    const forwarded = new URL(url.pathname.slice(PREFIX.length) || "/", url);
    forwarded.search = url.search;
    return env.FRAGMENT.getByName(ID).fetch(new Request(forwarded, request));
  },
};
