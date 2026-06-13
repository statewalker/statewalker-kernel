import { defineSlot } from "@statewalker/shared-slots";
import type { EditorFactory, Indexer, MimeIcon, MimeRenderer } from "./types.js";

/**
 * `files:mime-renderers` — `MimeRenderer` contributions. The
 * `files:visualize` default handler picks the best match (lowest
 * `order`, first match wins on ties) and opens a DockView panel
 * that looks up `viewKey` in `ViewRegistry`.
 */
export const mimeRenderersSlot = defineSlot<MimeRenderer>("files:mime-renderers");

/**
 * `files:mime-icons` — file-explorer iconography. Resolved client-side
 * by the breadcrumb / list views. Wave 5.1 declares only.
 */
export const mimeIconSlot = defineSlot<MimeIcon>("files:mime-icons");

/**
 * `files:editor-factories` — editing surface bindings. Wave 5.1
 * declares only; the editor host lands in a follow-up wave.
 */
export const editorFactoriesSlot = defineSlot<EditorFactory>("files:editor-factories");

/**
 * `files:indexers` — pluggable background indexers (FT search,
 * embeddings, etc.). Wave 5.1 declares only; the indexer runner
 * lands with the search wave.
 */
export const indexerSlot = defineSlot<Indexer>("files:indexers");
