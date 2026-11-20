import {
  type Catalog,
  type ComponentApi,
  MessageProcessor,
  STRICT_VALIDATION,
} from "@a2ui/web_core";

type ActionHandler = ConstructorParameters<typeof MessageProcessor>[1];

/**
 * Decision (statewalker-root#153): web_core runs with STRICT_VALIDATION, so unknown
 * component types, orphans and dangling references are rejected on input.
 */
export function createProcessor(
  catalogs: Catalog<ComponentApi>[],
  onAction?: ActionHandler,
): MessageProcessor {
  return new MessageProcessor(catalogs, onAction, { validationConfig: STRICT_VALIDATION });
}
