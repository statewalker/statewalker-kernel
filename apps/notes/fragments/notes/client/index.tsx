// The client half of the notes fragment: the notes view and the handlers of its commands (add-note,
// new-note). React, the shadcn primitives and the client API come from the shell's import map,
// never bundled here.
import { commands, dialogs, host, l10n, notifications, translator } from "@statewalker/client.core";
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
/** This fragment's texts in the interface language (its bundles in fragment.client.jsonc). */
const t = translator(NOTES);

/** Re-render when the interface language (or a bundle) changes. */
function useLanguage(): string {
  const [locale, setLocale] = useState(() => l10n.locale());
  useEffect(() => l10n.observe((state) => setLocale(state.locale)), []);
  return locale;
}

// The notes, in memory while the page lives (storage comes with system.profile).
let notes: readonly string[] = [];
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

/** The `add-note` command: add a note, answer how many there are. */
export function addNote({ text }: { text: string }): { count: number } {
  notes = [...notes, text];
  changed();
  return { count: notes.length };
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
    const index = notes.lastIndexOf(text);
    if (index < 0) return;
    notes = notes.filter((_, i) => i !== index);
    changed();
  });
  return { added: true };
}

/** The notes view: the notes, and a field whose button runs `add-note` on the command bus. */
export function NotesView() {
  const all = useSyncExternalStore(subscribe, () => notes);
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
      setError(failure instanceof Error ? failure.message : String(failure));
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
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <p data-testid="notes-count" className="m-0 text-xs text-muted-foreground">
          {t("view.count", { count: all.length }, "{count} notes")}
        </p>
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
          {all.map((note, index) => (
            // Notes have no ids yet; their position is stable while they cannot be removed.
            <li
              key={index}
              className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
            >
              <span>{note}</span>
              <Button type="button" variant="outline" size="sm" onClick={() => copy(note)}>
                {t("view.copy", {}, "Copy")}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
