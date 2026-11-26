// The client half of notes-export (statewalker/statewalker-root#261): its action on the notes view,
// the `export-notes` command, and the Exports view. Every export is kept by its server half's DO.
// React, the shadcn primitives and the client API come from the shell's import map.
import { commands, servers } from "@statewalker/client.core";
import { Card, CardContent, CardHeader, CardTitle } from "@statewalker/ui.view.shadcn";
import { useEffect, useState, useSyncExternalStore } from "react";

const ID = "org.statewalker.notes-export";
const LIST_NOTES = "org.statewalker.notes/list-notes";
const server = servers.of(ID);

/** One export, as the server half keeps it. */
interface Export {
  readonly id: number;
  readonly count: number;
  readonly text: string;
  readonly at: number;
}

let exports: readonly Export[] = [];
let failure: string | undefined;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const changed = () => {
  for (const listener of [...listeners]) listener();
};

async function call(path: string, init?: RequestInit): Promise<unknown> {
  if (!server.available())
    throw new Error("notes-export needs its server half, which does not run here");
  const res = await server.fetch(path, init);
  const body = await res.text();
  if (!res.ok)
    throw new Error(`notes-export server half: ${res.status} ${body || res.statusText}`.trim());
  return body ? JSON.parse(body) : undefined;
}

/** Read the exports again from the server half. */
async function refresh(): Promise<void> {
  try {
    exports = ((await call("exports")) as { exports: Export[] }).exports;
    failure = undefined;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  changed();
}

async function save(notes: readonly { text: string }[]): Promise<Export> {
  const saved = (await call("exports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ notes: notes.map(({ text }) => ({ text })) }),
  })) as Export;
  exports = [...exports, saved];
  changed();
  return saved;
}

/** The action on the notes view: export the notes as shown. */
export async function exportAction({
  notes,
}: {
  notes: readonly { text: string }[];
}): Promise<{ message: string }> {
  const saved = await save(notes);
  return { message: `Exported ${saved.count} notes (export ${saved.id})` };
}

/** The `export-notes` command: export the notes the notes fragment lists. */
export async function exportNotes(): Promise<{ id: number; count: number }> {
  const { notes } = await commands.call<{ notes: { text: string }[] }>(LIST_NOTES);
  const saved = await save(notes);
  return { id: saved.id, count: saved.count };
}

/** The Exports view: every export, newest first. */
export function ExportsView() {
  const all = useSyncExternalStore(subscribe, () => exports);
  const error = useSyncExternalStore(subscribe, () => failure);
  // The DO is read as the view opens; the count shows once that read has answered.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void refresh().then(() => setLoaded(true));
  }, []);
  return (
    <Card data-testid="exports-view" className="m-4">
      <CardHeader>
        <CardTitle>Exports</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && (
          <p role="alert" className="m-0 text-sm text-destructive">
            {error}
          </p>
        )}
        {loaded && (
          <p data-testid="exports-count" className="m-0 text-xs text-muted-foreground">
            {all.length} exports
          </p>
        )}
        <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
          {[...all].reverse().map((e) => (
            <li key={e.id} data-testid="export" className="rounded-md border px-3 py-2">
              <div className="text-xs text-muted-foreground">
                Export {e.id}: {e.count} notes, {new Date(e.at).toLocaleString()}
              </div>
              <pre className="m-0 whitespace-pre-wrap">{e.text}</pre>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
