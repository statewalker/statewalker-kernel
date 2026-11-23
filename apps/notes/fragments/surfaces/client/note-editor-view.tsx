// The NoteEditor's view: one CodeMirror EditorView per mounted component, which owns the cursor,
// the selection and the undo history. Values pushed to the bound path are applied in place as
// the smallest change, outside the undo history; the user's edits are written back (debounced).
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { RenderProps } from "@statewalker/system.a2ui";
import { useEffect, useRef } from "react";

/** Common prefix/suffix diff: one replaced range. */
function minimalChange(a: string, b: string) {
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a[start] === b[start]) start++;
  let end = 0;
  while (end < max - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return { from: start, to: a.length - end, insert: b.slice(start, b.length - end) };
}

export default function NoteEditorView({ props, write }: RenderProps<{ value: string }>) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const writeRef = useRef(write);
  writeRef.current = write;
  const initial = useRef(props.value);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      writeRef.current?.("value", view.current?.state.doc.toString() ?? "");
    };
    const v = new EditorView({
      parent: host.current as HTMLDivElement,
      state: EditorState.create({
        doc: initial.current,
        extensions: [
          history(),
          keymap.of([...historyKeymap, ...defaultKeymap]),
          EditorView.updateListener.of((u) => {
            const remote = u.transactions.some((t) => t.annotation(Transaction.remote));
            if (u.docChanged && !remote) {
              clearTimeout(timer);
              timer = setTimeout(flush, 250);
            }
          }),
          EditorView.domEventHandlers({ blur: () => void flush() }),
        ],
      }),
    });
    view.current = v;
    return () => {
      if (timer !== undefined) flush();
      v.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === props.value) return; // equal: keep everything
    v.dispatch({
      changes: minimalChange(v.state.doc.toString(), props.value),
      annotations: [Transaction.addToHistory.of(false), Transaction.remote.of(true)],
    });
  }, [props.value]);

  return <div ref={host} data-note-editor className="min-h-24 rounded-md border" />;
}
