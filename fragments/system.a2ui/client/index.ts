// The client half of system.a2ui (React): the renderer, the basic components, and surfaces that
// pop out into the workbench's dock.
export { emitComponentEvent } from "../src/index.js";
export { basicRenderers } from "./basic-renderers.js";
export { createRegistry, viewOf } from "./registry.js";
export { A2uiNode, A2uiSurface, type Registry } from "./renderer.js";
export { A2uiSurfaceView, type A2uiSurfaceViewProps, createSurfaceDock } from "./surface-view.js";
