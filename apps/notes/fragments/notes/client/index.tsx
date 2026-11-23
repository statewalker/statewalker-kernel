// The client half of the notes fragment: the notes view and the add-note command's handler. React,
// the shadcn primitives and the client API come from the shell's import map, never bundled here.
import { commands } from "@statewalker/client.core";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
} from "@statewalker/ui.view.shadcn";
import { type FormEvent, useState, useSyncExternalStore } from "react";

const ADD_NOTE = "org.statewalker.notes/add-note";

// The notes, in memory while the page lives (storage comes with system.profile).
let notes: readonly string[] = [];
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The `add-note` command: add a note, answer how many there are. */
export function addNote({ text }: { text: string }): { count: number } {
  notes = [...notes, text];
  for (const listener of [...listeners]) listener();
  return { count: notes.length };
}

/** The notes view: the notes, and a field whose button runs `add-note` on the command bus. */
export function NotesView() {
  const all = useSyncExternalStore(subscribe, () => notes);
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();

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
    <Card data-testid="notes-view" className="m-4">
      <CardHeader>
        <CardTitle>Notes</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <form onSubmit={submit} className="flex gap-2">
          <Input
            aria-label="Note"
            placeholder="Write a note"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit">Add note</Button>
        </form>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
          {all.map((note, index) => (
            // Notes have no ids yet; their position is stable while they cannot be removed.
            <li key={index} className="rounded-md border px-3 py-2">
              {note}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
