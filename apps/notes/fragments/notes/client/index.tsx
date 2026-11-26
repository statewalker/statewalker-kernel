// The client half of the notes fragment: the notes view and the handlers of its commands (add-note,
// new-note). React, the shadcn primitives and the client API come from the shell's import map,
// never bundled here.
import {
  type ClientSettingsValues,
  commands,
  dialogs,
  host,
  l10n,
  notifications,
  servers,
  settings,
  translator,
} from "@statewalker/client.core";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
} from "@statewalker/ui.view.shadcn";
import { type FormEvent, useEffect, useState, useSyncExternalStore } from "react";

const NOTES = "org.statewalker.notes";
const ADD_NOTE = `${NOTES}/add-note`;
/** Declared in fragment.client.jsonc, on system.workbench's `dialogs` and `notifications` points. */
const NEW_NOTE_DIALOG = `${NOTES}/new-note`;
const NOTE_ADDED = `${NOTES}/note-added`;
/** This fragment's own settings values (system.settings, kept in the user's profile). */
const own = settings.of(NOTES);
/** This fragment's texts in the interface language (its bundles in fragment.client.jsonc). */
const t = translator(NOTES);

/** Re-render when the interface language (or a bundle) changes. */
function useLanguage(): string {
  const [locale, setLocale] = useState(() => l10n.locale());
  useEffect(() => l10n.observe((state) => setLocale(state.locale)), []);
  return locale;
}

/** A note: its text, and its id in the server half's DO when it is kept there. */
interface Note {
  readonly id?: number;
  readonly text: string;
}

// The notes. With a server half (statewalker-root#436), kept in its fragment DO and mirrored here;
// without one (launch configuration `none`), in memory while the page lives.
const server = servers.of(NOTES);
let notes: readonly Note[] = [];
/** Why the server half could not be read or written, shown in the view. */
let serverError: string | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function changed() {
  for (const listener of [...listeners]) listener();
}

/** A server half's answer, or an error naming its status (503 when it is disabled). */
async function call(path: string, init?: RequestInit): Promise<unknown> {
  const res = await server.fetch(path, init);
  const body = await res.text();
  if (!res.ok) throw new Error(`notes server half: ${res.status} ${body || res.statusText}`.trim());
  return body ? JSON.parse(body) : undefined;
}

/** Read the notes from the server half, once its view opens. */
let loading: Promise<void> | undefined;
function load(): Promise<void> {
  if (!server.available()) return Promise.resolve();
  loading ??= call("notes")
    .then((answer) => {
      notes = (answer as { notes: Note[] }).notes.map(({ id, text }) => ({ id, text }));
      serverError = undefined;
    })
    .catch((failure: unknown) => {
      loading = undefined; // tried again on the next open
      serverError = failure instanceof Error ? failure.message : String(failure);
    })
    .finally(changed);
  return loading;
}

/** The `add-note` command: add a note, answer how many there are. */
export async function addNote({ text }: { text: string }): Promise<{ count: number }> {
  if (!server.available()) {
    notes = [...notes, { text }];
    changed();
    return { count: notes.length };
  }
  await load();
  const saved = (await call("notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  })) as { id: number; count: number };
  notes = [...notes, { id: saved.id, text }];
  serverError = undefined;
  changed();
  return { count: saved.count };
}

/** Undo: remove the last note with `text`, in the server half too. */
async function removeNote(text: string): Promise<void> {
  const index = notes.map((n) => n.text).lastIndexOf(text);
  const note = notes[index];
  if (!note) return;
  if (note.id !== undefined) await call(`notes/${note.id}`, { method: "DELETE" });
  notes = notes.filter((n) => n !== note);
  changed();
}

/**
 * The `new-note` command (menus, palette, keybinding): ask for the text in the declared dialog,
 * add the note, and say so in the declared notification, whose Undo removes it again.
 */
export async function newNote(): Promise<{ added: boolean }> {
  const answer = await dialogs.show(NEW_NOTE_DIALOG);
  const text = answer.value?.trim();
  if (answer.action !== "add" || !text) return { added: false };
  await commands.call(ADD_NOTE, { text });
  void notifications.show(NOTE_ADDED, { text }).then(({ action }) => {
    if (action !== "undo") return;
    removeNote(text).catch((failure: unknown) => {
      serverError = failure instanceof Error ? failure.message : String(failure);
      changed();
    });
  });
  return { added: true };
}

/** An error's message, with its causes (the bus wraps a handler's error as `cause`). */
function describe(failure: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = failure; e !== undefined && parts.length < 4; ) {
    parts.push(e instanceof Error ? e.message : String(e));
    e = e instanceof Error ? e.cause : undefined;
  }
  return parts.join(": ");
}

/** This fragment's settings (its page in fragment.client.jsonc), followed as they change. */
function useSettings(): ClientSettingsValues {
  const [values, setValues] = useState(() => own.values());
  useEffect(() => own.observe(setValues), []);
  return values;
}

/**
 * The notes view: the notes, in the order the `sort` setting asks, and a field whose button runs
 * `add-note` on the command bus; each note's Copy button while `copyButtons` is on.
 */
export function NotesView() {
  const added = useSyncExternalStore(subscribe, () => notes).map((n) => n.text);
  const loadError = useSyncExternalStore(subscribe, () => serverError);
  useEffect(() => {
    void load();
  }, []);
  const { sort, copyButtons } = useSettings();
  const all = sort === "alphabetical" ? [...added].sort((a, b) => a.localeCompare(b)) : added;
  const locale = useLanguage();
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();

  /** Copy a note through system.host's clipboard service (on the user's click: a user gesture). */
  async function copy(note: string) {
    try {
      await host.clipboard.writeText(note);
      setError(undefined);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await commands.call(ADD_NOTE, { text });
      setText("");
      setError(undefined);
    } catch (failure) {
      setError(describe(failure));
    }
  }

  return (
    <Card data-testid="notes-view" className="m-4" lang={locale}>
      <CardHeader>
        <CardTitle data-testid="notes-title">{t("view.title", {}, "Notes")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form onSubmit={submit} className="flex gap-2">
          <Input
            aria-label={t("view.field", {}, "Note")}
            placeholder={t("view.placeholder", {}, "Write a note")}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit">{t("view.add", {}, "Add note")}</Button>
        </form>
        {(error ?? loadError) && (
          <p role="alert" className="text-sm text-destructive">
            {error ?? loadError}
          </p>
        )}
        <p data-testid="notes-count" className="m-0 text-xs text-muted-foreground">
          {t("view.count", { count: all.length }, "{count} notes")}
        </p>
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
          {all.map((note, index) => (
            // Notes have no ids yet; a key by position re-renders the texts when the order changes.
            <li
              key={index}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
            >
              <span>{note}</span>
              {copyButtons !== false && (
                <Button type="button" variant="outline" size="sm" onClick={() => copy(note)}>
                  {t("view.copy", {}, "Copy")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
