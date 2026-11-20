import { Command, passthrough } from "@statewalker/shared-commands";
import { lazy } from "react";
import { z } from "zod";
import { defineComponent } from "../define-component.js";

export const SaveDocumentCommand = Command.required("proto:save-document")
  .input(z.object({ value: z.string() }))
  .output(passthrough<unknown>())
  .label("Save document")
  .build();

export const codeEditorProps = z.object({
  value: z.string(),
  language: z.enum(["markdown", "plain"]).optional(),
  readOnly: z.boolean().optional(),
});
export const codeEditorEvents = z.object({
  change: z.object({ value: z.string() }),
  save: z.object({ value: z.string() }),
});

/**
 * The catalog entry (schema, events, command) is light and static; the CodeMirror view is
 * loaded on first render, so the editor's code is only fetched when an agent places one.
 */
export const CodeEditor = defineComponent({
  name: "CodeEditor",
  description:
    "A text/code editor. `value` is the initial document; bind it to a data-model path " +
    "to push new content. `change` fires on blur, `save` on Ctrl/Cmd-S or the Save button.",
  props: codeEditorProps,
  events: codeEditorEvents,
  commands: { save: SaveDocumentCommand },
  literalOnly: ["language"],
  render: lazy(() => import("./code-editor-view.js")),
});
