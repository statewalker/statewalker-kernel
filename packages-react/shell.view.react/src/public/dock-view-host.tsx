import type { Workspace } from "@statewalker/workspace.core";
import { DockviewReact, type DockviewReadyEvent } from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import "../internal/dock-view-host.css";
import { DockHost } from "@statewalker/shell.core";
import { type ReactElement, useCallback, useEffect } from "react";
import { JsonPanel } from "../internal/json-panel.js";
import { LineTab } from "../internal/line-tab.js";

const components = { json: JsonPanel } as const;

interface DockViewHostProps {
  workspace: Workspace;
}

/**
 * The DockView host component (named mount point — App.tsx renders
 * this when the workspace is open). On `onReady`, captures the
 * `DockviewApi` and binds it to the workspace's `DockHost` adapter
 * so the `dock:*` command handlers can dispatch (or replay queued
 * dispatches) against a real DockView instance.
 *
 * One DockView component kind is registered: `"json"` →
 * `<JsonPanel>`. Any future panel kind would defeat the
 * spec-as-extension-mechanism architecture (vision §3.3 / D1).
 *
 * `workspace` arrives as a prop so the host is renderable from
 * anywhere a Workspace instance is in scope (e.g. test harnesses).
 * `JsonPanel` itself reads the workspace via `useAppWorkspace()`
 * — dockview-react renders panels through React.createPortal so
 * React context propagates from the parent tree.
 */
export function DockViewHost({ workspace }: DockViewHostProps): ReactElement {
  const dockHost = workspace.requireAdapter(DockHost);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      dockHost.setApi(event.api);
    },
    [dockHost],
  );

  useEffect(() => {
    return () => dockHost.detach();
  }, [dockHost]);

  return (
    <DockviewReact
      components={components}
      defaultTabComponent={LineTab}
      onReady={onReady}
      className="dockview-theme-light dockview-theme-line h-full w-full"
    />
  );
}
