import { newRegistry } from "@statewalker/shared-registry";
import { getWorkspace } from "@statewalker/workspace.core";
import { SettingsManager } from "../internal/settings.manager.js";
import { Settings } from "./settings.adapter.js";

/**
 * Logic-fragment init for `settings`. Registers the `Settings`
 * adapter (state) and the `SettingsManager` (command handlers).
 * Per ADR 0002 (logic-only): no React imports.
 *
 * Boot order: register AFTER the substrate fragments
 * (CatalogRegistry, SpecStore, Dock, Workspace-bridge) and BEFORE
 * any fragment that contributes to `settings:tabs` (e.g.
 * `providers/`).
 */
export default function initSettings(ctx: Record<string, unknown>): () => Promise<void> {
  const workspace = getWorkspace(ctx);
  workspace.setAdapter(Settings);

  const [register, cleanup] = newRegistry();
  const manager = new SettingsManager({ workspace });
  register(() => manager.close());

  return cleanup;
}
