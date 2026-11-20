import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useRef } from "react";
import type { z } from "zod";
import type { RenderProps } from "../define-component.js";
import type { codeEditorEvents, codeEditorProps } from "./code-editor.js";

type Props = RenderProps<z.infer<typeof codeEditorProps>, typeof codeEditorEvents>;

/** Common prefix/suffix diff: one replaced range. Enough for agent pushes of a whole doc. */
function minimalChange(a: string, b: string) {
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a[start] === b[start]) start++;
  let end = 0;
  while (end < max - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return { from: start, to: a.length - end, insert: b.slice(start, b.length - end) };
}

/**
 * The EditorView is created once per mounted node and owns its state (cursor, selection,
 * undo). Agent updates of `value` are reconciled into it, never by remounting.
 */
export default function CodeEditorView({ props, emit, write }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const emitRef = useRef(emit);
  emitRef.current = emit; // a fresh closure each render; the view keeps calling the latest
  const writeRef = useRef(write);
  writeRef.current = write;
  const readOnly = useRef(new Compartment());

  useEffect(() => {
    const current = () => view.current?.state.doc.toString() ?? "";
    // Two-way binding: user edits flow back to the bound data-model path (debounced), so the
    // agent's data model, and any push it builds from it, includes them.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      clearTimeout(timer);
      timer = undefined;
      writeRef.current?.("value", current());
    };
    const save = () => (flush(), emitRef.current("save", { value: current() }), true);
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: props.value,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([{ key: "Mod-s", run: save }, ...historyKeymap, ...defaultKeymap]),
          props.language === "markdown" ? markdown() : [],
          readOnly.current.of(EditorState.readOnly.of(!!props.readOnly)),
          EditorView.updateListener.of((u) => {
            const remote = u.transactions.some((t) => t.annotation(Transaction.remote));
            if (u.docChanged && !remote) {
              clearTimeout(timer);
              timer = setTimeout(flush, 250);
            }
          }),
          EditorView.domEventHandlers({
            blur: () => (flush(), void emitRef.current("change", { value: current() })),
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      clearTimeout(timer);
      v.destroy();
      view.current = null;
    };
  }, []); // `language` is literal-only: a new language is a new component, not an update

  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === props.value) return; // equal: keep everything
    // Remote content: apply the smallest change, outside the user's undo history, so the
    // user's edits elsewhere stay undoable (a full replace would drop them from history).
    v.dispatch({
      changes: minimalChange(v.state.doc.toString(), props.value),
      annotations: [Transaction.addToHistory.of(false), Transaction.remote.of(true)],
    });
  }, [props.value]);

  useEffect(() => {
    view.current?.dispatch({
      effects: readOnly.current.reconfigure(EditorState.readOnly.of(!!props.readOnly)),
    });
  }, [props.readOnly]);

  return (
    <div className="code-editor">
      <div className="code-editor-bar">
        <span>{props.language ?? "plain"}</span>
        <button
          type="button"
          data-cm-save
          onClick={() => {
            const value = view.current?.state.doc.toString() ?? "";
            write?.("value", value);
            emit("save", { value });
          }}
        >
          Save
        </button>
      </div>
      <div ref={host} className="code-editor-host" />
    </div>
  );
}
