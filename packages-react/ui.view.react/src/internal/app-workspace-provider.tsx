import type { Workspace } from "@statewalker/workspace.core";
import { createContext, type ReactNode, useContext } from "react";

const AppWorkspaceContext = createContext<Workspace | null>(null);

interface AppWorkspaceProviderProps {
  workspace: Workspace;
  children: ReactNode;
}

/**
 * Provides the application-wide `Workspace` instance from
 * `@statewalker/workspace` to React consumers. The provider lives in
 * the renderer fragment because React-tree glue routing typed
 * contracts is contract surface in renderer fragments.
 *
 * The Workspace is created in `main.tsx` BEFORE React mounts; this
 * provider only carries the already-existing instance into the
 * React tree.
 */
export function AppWorkspaceProvider({
  workspace,
  children,
}: AppWorkspaceProviderProps): ReactNode {
  return <AppWorkspaceContext.Provider value={workspace}>{children}</AppWorkspaceContext.Provider>;
}

/**
 * Read the application-wide `Workspace` from React context.
 * Throws if used outside `<AppWorkspaceProvider>`.
 */
export function useAppWorkspace(): Workspace {
  const ws = useContext(AppWorkspaceContext);
  if (!ws) {
    throw new Error("useAppWorkspace must be used inside <AppWorkspaceProvider>.");
  }
  return ws;
}
