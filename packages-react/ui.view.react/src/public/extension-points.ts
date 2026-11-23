import { defineKeyedSlot } from "@statewalker/shared-slots";
import type { ComponentType } from "react";

/**
 * Generic shape of a view component registered in the `core:views`
 * slot. Concrete components may take richer prop types; the slot
 * holds them opaquely (consumers cast at usage time).
 */
export type ViewComponent = ComponentType<unknown>;

/**
 * The id-keyed slot carrying React components by stable `viewKey`.
 * Renderer fragments register their components here; logic fragments
 * reference viewKeys as data and resolve to components at render time
 * via `useKeyedSlot(slots, coreViewsSlot)`.
 *
 * ViewKey naming convention: `<owning-logic-fragment-id>:<purpose>` —
 * e.g. `chat:turn-block:tool-call`, `providers:model-picker`.
 */
export const coreViewsSlot = defineKeyedSlot<ViewComponent>("core:views");

/**
 * Root viewKey for the top-level application shell. The shell renderer
 * fragment (dock-views) registers its `MainShell` here; `<App/>` renders
 * whatever is registered under this key once the workspace is `ready`.
 * This keeps the `core-react` ↔ `dock-react` edge one-way (`dock → core`):
 * `core-react` never imports the shell, it resolves it through the slot.
 */
export const SHELL_ROOT_VIEW_KEY = "shell:root";
