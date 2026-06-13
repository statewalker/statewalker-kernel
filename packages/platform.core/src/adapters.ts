import { Commands } from "@statewalker/shared-commands";
import { getWorkspace } from "@statewalker/workspace.core";

/**
 * Resolve the workspace-scoped `Commands` bus for the given context bag.
 * Delegates to `workspace.requireAdapter(Commands)`, which auto-instantiates
 * a single shared bus on first lookup so every fragment composed under the
 * same workspace dispatches through the same instance.
 */
export function getCommands(ctx: Record<string, unknown>): Commands {
  return getWorkspace(ctx).requireAdapter(Commands);
}

/**
 * @deprecated The commands bus is now workspace-scoped and auto-instantiated;
 * explicit registration is a no-op. Kept for one release so legacy bootstrap
 * code keeps compiling. Will be removed in a follow-up phase.
 */
export function setCommands(_ctx: Record<string, unknown>, _commands: Commands): void {
  console.warn(
    "[platform-api] setCommands is deprecated and a no-op: the Commands bus is now workspace-bound and auto-instantiated via workspace.requireAdapter(Commands).",
  );
}

/**
 * @deprecated The commands bus is now workspace-scoped and lifecycle-managed by
 * the workspace; explicit removal is a no-op. Kept for one release so legacy
 * teardown code keeps compiling. Will be removed in a follow-up phase.
 */
export function removeCommands(_ctx: Record<string, unknown>): void {
  console.warn(
    "[platform-api] removeCommands is deprecated and a no-op: the Commands bus lifecycle is owned by workspace.close().",
  );
}
