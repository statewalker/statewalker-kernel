import { defineCatalog, defineSchema } from "@json-render/core";
import { z } from "zod";

/**
 * Minimal json-render catalog in the shape the kernel's renderers register in the
 * `json:catalogs` slot. render.core itself holds registries opaquely (no
 * @json-render dependency, no component definitions), so there is nothing to
 * import from it directly; this stands in for a real json-render catalog.
 */
const schema = defineSchema((s) => ({
  spec: s.object({
    root: s.object({
      type: s.ref("catalog.components"),
      props: s.propsOf("catalog.components"),
      children: s.array(s.string()),
    }),
  }),
  catalog: s.object({
    components: s.map({ props: s.zod(), description: s.string() }),
    actions: s.map({ description: s.string() }),
  }),
}));

export const legacyJsonRenderCatalog = defineCatalog(schema, {
  components: {
    StatusBadge: {
      props: z.object({ label: z.string(), tone: z.enum(["ok", "warn", "error"]).nullable() }),
      description: "A small status badge",
    },
  },
  actions: {},
});
