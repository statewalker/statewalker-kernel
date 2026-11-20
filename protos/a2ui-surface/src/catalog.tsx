import type { Catalog, ComponentApi } from "@a2ui/web_core";
import { Command, passthrough } from "@statewalker/shared-commands";
import { z } from "zod";
import { basicRenderers } from "./basic-renderers.js";
import { CodeEditor } from "./components/code-editor.js";
import { MapView } from "./components/map-view.js";
import { buildCatalog, defineComponent } from "./define-component.js";
import type { Registry } from "./renderer.js";

export const PROTO_CATALOG_ID = "https://statewalker.dev/a2ui/proto/catalog.json";

/** The platform command the ConfirmCard's `confirm` event maps to. */
export const ConfirmCommand = Command.required("proto:confirm")
  .input(z.object({ title: z.string() }))
  .output(passthrough<unknown>())
  .label("Confirm")
  .build();

export const ConfirmCard = defineComponent({
  name: "ConfirmCard",
  description: "Asks the user to confirm one action.",
  props: z.object({ title: z.string(), body: z.string(), confirmLabel: z.string() }),
  events: z.object({ confirm: z.object({ title: z.string() }) }),
  commands: { confirm: ConfirmCommand },
  render: ({ props, emit }) => (
    <section className="confirm-card">
      <h3>{props.title}</h3>
      <p>{props.body}</p>
      <button type="button" onClick={() => emit("confirm", { title: props.title })}>
        {props.confirmLabel}
      </button>
    </section>
  ),
});

export { SaveDocumentCommand } from "./components/code-editor.js";
export { SelectPlaceCommand } from "./components/map-view.js";
export { CodeEditor, MapView };

export const protoComponents = [ConfirmCard, CodeEditor, MapView];

// Annotation needed: web_core's public types leak zod 3 (TS2883 without it).
export const protoCatalog: Catalog<ComponentApi> = buildCatalog({
  catalogId: PROTO_CATALOG_ID,
  basic: ["Text", "Column", "Row", "Card", "Button"],
  components: protoComponents,
});

export const protoRegistry: Registry = {
  ...basicRenderers,
  ConfirmCard: ConfirmCard.render,
  CodeEditor: CodeEditor.render,
  MapView: MapView.render,
};
