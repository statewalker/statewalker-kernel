import type { SurfaceModel } from "@a2ui/web_core";

/**
 * A component's event enters A2UI's action path (a client-side extension: A2UI has no
 * component events); the action router maps it to a command by the component's type.
 */
export function emitComponentEvent(
  surface: SurfaceModel,
  componentId: string,
  name: string,
  payload: unknown,
) {
  return surface.dispatchAction({ event: { name, context: payload } }, componentId);
}
