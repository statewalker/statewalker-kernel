import { Slots } from "@statewalker/shared-slots";
import { WorkspaceShellAdapter } from "@statewalker/workspace.browser";
import type { ReactElement } from "react";
import { coreViewsSlot, SHELL_ROOT_VIEW_KEY } from "../public/extension-points.js";
import { DirectoryPickerEmptyState } from "./directory-picker-empty-state.js";
import { useAdapter } from "./use-adapter.js";
import { useAdapterValue } from "./use-adapter-value.js";
import { useKeyedSlot } from "./use-slot.js";

/**
 * Root surface switch. Reads `WorkspaceShellAdapter` via
 * `useAdapterValue` and renders one of two top-level surfaces:
 *
 *   - `<DirectoryPickerEmptyState/>` whenever the workspace shell is
 *     `loading | unsupported | empty | needs-permission`. The single
 *     component covers all four; the picker UI knows how to render
 *     each branch.
 *   - the shell registered under `SHELL_ROOT_VIEW_KEY` in `core:views`
 *     once the shell reaches `ready`. The shell renderer fragment
 *     (dock-views) registers `MainShell` there, so `core-react` resolves
 *     it through the slot rather than importing it — keeping the
 *     `core-react` ↔ `dock-react` edge one-way (`dock → core`).
 */
export function App(): ReactElement | null {
  const state = useAdapterValue(WorkspaceShellAdapter, (a) => a.getState());
  const slots = useAdapter(Slots);
  const views = useKeyedSlot(slots, coreViewsSlot);
  if (state.status !== "ready") {
    return <DirectoryPickerEmptyState />;
  }
  const Shell = views.get(SHELL_ROOT_VIEW_KEY);
  return Shell ? <Shell /> : null;
}
