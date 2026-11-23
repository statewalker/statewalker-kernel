import type { Catalog, ComponentApi } from "@a2ui/web_core";
import { basicCatalog } from "@a2ui/web_core/catalogs/basic/v1";
import type { CatalogComponent } from "./define-component.js";

/** The catalog id of the platform's surfaces. */
export const PLATFORM_CATALOG_ID = "https://statewalker.dev/a2ui/v1/catalog.json";

/**
 * The basic A2UI components the platform renders (`./client`'s `basicRenderers`). The rest of
 * web_core's basic catalog is not offered: a surface placing it is refused on input.
 */
export const BASIC_COMPONENTS = ["Text", "Column", "Row", "Card", "Button"] as const;

/** A 1.0 catalog: the named basic components from web_core, plus ours. */
export function buildCatalog(opts: {
  catalogId: string;
  basic: readonly string[];
  components: readonly CatalogComponent[];
}): Catalog<ComponentApi> {
  const base = basicCatalog as unknown as Catalog<ComponentApi>;
  return base.derive({
    catalogId: opts.catalogId,
    components: [...opts.basic, ...opts.components.map((c) => c.api)],
  });
}
