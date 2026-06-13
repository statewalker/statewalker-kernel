import { newAdapter } from "@statewalker/shared-adapters";

/**
 * Workspace layout defaults. Tests and hosts MAY override these via
 * `setWorkspaceConfig(ctx, ...)` BEFORE `workspace.core.activate(ctx)` runs.
 *
 * - `systemDir` — subfolder of the root that is hidden from the main files view
 *   and exposed as the system files view. Defaults to `.settings`.
 * - `secretsDir` — subfolder of the system view where per-key JSON secrets live.
 * - `settingsDir` — sibling subfolder for non-sensitive JSON-per-key user settings.
 * - `sessionsDir` — where chat sessions persist. Default `""` places sessions at
 *   the root of `systemFiles` (matches the existing on-disk layout).
 * - `modelsDir` — where ai-config downloads model weights.
 */
export interface WorkspaceConfig {
  systemDir: string;
  secretsDir: string;
  settingsDir: string;
  sessionsDir: string;
  modelsDir: string;
}

export const DEFAULT_WORKSPACE_CONFIG: Readonly<WorkspaceConfig> = Object.freeze({
  systemDir: ".settings",
  secretsDir: "secrets",
  settingsDir: "settings",
  sessionsDir: "",
  modelsDir: "models",
});

export const [getWorkspaceConfig, setWorkspaceConfig, removeWorkspaceConfig] =
  newAdapter<WorkspaceConfig>("workspace:config", () => ({
    ...DEFAULT_WORKSPACE_CONFIG,
  }));
