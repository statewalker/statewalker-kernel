import {
  type Catalog,
  type ComponentApi,
  MessageProcessor,
  STRICT_VALIDATION,
} from "@a2ui/web_core";

export type ActionHandler = ConstructorParameters<typeof MessageProcessor>[1];

/**
 * web_core with STRICT_VALIDATION: unknown component types, props a component does not declare,
 * orphans and dangling references are rejected on input. The only way the platform builds a
 * processor.
 */
export function createProcessor(
  catalogs: Catalog<ComponentApi>[],
  onAction?: ActionHandler,
): MessageProcessor {
  return new MessageProcessor(catalogs, onAction, { validationConfig: STRICT_VALIDATION });
}
