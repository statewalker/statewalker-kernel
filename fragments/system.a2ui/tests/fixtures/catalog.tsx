// The A2UI prototype's catalog (statewalker-kernel branch claude/great-faraday-igm9os,
// protos/a2ui-surface/src/catalog.tsx), ported to the platform: events map to command ids on the
// bus (`<fragment-id>/<command-id>`) instead of shared-commands declarations.
import type { Catalog, ComponentApi } from "@a2ui/web_core";
import { z } from "zod";
import { createRegistry, type Registry } from "../../client/index.js";
import { buildCatalog, defineComponent } from "../../src/index.js";
import { CodeEditor, SAVE_DOCUMENT } from "./code-editor.js";
import { MapView, SELECT_PLACE } from "./map-view.js";

export const PROTO_CATALOG_ID = "https://statewalker.dev/a2ui/proto/catalog.json";

/** The command the ConfirmCard's `confirm` event maps to. */
export const CONFIRM = "org.example.proto/confirm";

export const ConfirmCard = defineComponent({
  name: "ConfirmCard",
  description: "Asks the user to confirm one action.",
  props: z.object({ title: z.string(), body: z.string(), confirmLabel: z.string() }),
  events: z.object({ confirm: z.object({ title: z.string() }) }),
  commands: { confirm: CONFIRM },
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

export { CodeEditor, MapView, SAVE_DOCUMENT, SELECT_PLACE };

export const protoComponents = [ConfirmCard, CodeEditor, MapView];

// Annotation needed: web_core's public types leak zod 3 (TS2883 without it).
export const protoCatalog: Catalog<ComponentApi> = buildCatalog({
  catalogId: PROTO_CATALOG_ID,
  basic: ["Text", "Column", "Row", "Card", "Button"],
  components: protoComponents,
});

export const protoRegistry: Registry = createRegistry(protoComponents);
