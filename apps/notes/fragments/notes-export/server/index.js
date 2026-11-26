// The server half of the notes-export fragment (statewalker/statewalker-root#261): its fragment DO
// keeps every export of the notes in SQLite.
//
//   GET  /exports           → 200 { exports: [{ id, count, text, at }] }, oldest first
//   POST /exports { notes } → 201 { id, count, text, at }  (notes: [{ text }])
//
// The fragment hosts route `/fragments/org.statewalker.notes-export/<path>` to the object at
// `idFromName("org.statewalker.notes-export")`; the Worker's own fetch does the same under
// `wrangler dev`.
import { DurableObject } from "cloudflare:workers";

const ID = "org.statewalker.notes-export";
const PREFIX = `/fragments/${ID}`;
/** The most notes one export takes, and the longest text it keeps. */
const MAX_NOTES = 1_000;
const MAX_TEXT = 1_000_000;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export class ExportsFragment extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS exports (id INTEGER PRIMARY KEY AUTOINCREMENT, count INTEGER NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL)",
    );
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname !== "/exports") return json({ error: "not found" }, 404);
    if (request.method === "GET") {
      const exports = this.ctx.storage.sql
        .exec("SELECT id, count, text, at FROM exports ORDER BY id")
        .toArray();
      return json({ exports });
    }
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
    let notes;
    try {
      ({ notes } = await request.json());
    } catch {
      return json({ error: "the body is not JSON" }, 400);
    }
    if (
      !Array.isArray(notes) ||
      notes.length > MAX_NOTES ||
      !notes.every((n) => n && typeof n.text === "string")
    )
      return json({ error: `notes must be at most ${MAX_NOTES} objects with a text` }, 400);
    // The export: the notes as a Markdown list.
    const text = notes.map((n) => `- ${n.text.replaceAll("\n", " ")}`).join("\n");
    if (text.length > MAX_TEXT) return json({ error: "the export is too long" }, 400);
    const at = Date.now();
    const [row] = this.ctx.storage.sql
      .exec(
        "INSERT INTO exports (count, text, at) VALUES (?, ?, ?) RETURNING id",
        notes.length,
        text,
        at,
      )
      .toArray();
    return json({ id: row.id, count: notes.length, text, at }, 201);
  }
}

export default {
  /** `/fragments/org.statewalker.notes-export/<path>` → the fragment DO at `/<path>` (wrangler dev). */
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`))
      return json({ error: "not found" }, 404);
    const forwarded = new URL(url.pathname.slice(PREFIX.length) || "/", url);
    forwarded.search = url.search;
    return env.FRAGMENT.getByName(ID).fetch(new Request(forwarded, request));
  },
};
