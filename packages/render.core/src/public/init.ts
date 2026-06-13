import { Commands } from "@statewalker/shared-commands";
import { newRegistry } from "@statewalker/shared-registry";
import { getWorkspace } from "@statewalker/workspace";
import { CreateSpecCommand, PatchSpecCommand } from "./commands.js";
import { SpecStore } from "./spec-store.js";

/**
 * Attach a `SpecStore` to the workspace and register the default
 * `spec:create` / `spec:patch` command handlers. After this fragment
 * runs, every other fragment can:
 *   - resolve the store via `workspace.requireAdapter(SpecStore)`
 *   - invoke `commands.call(CreateSpecCommand, ...)` / `commands.call(PatchSpecCommand, ...)`
 *
 * Returns the cleanup; LIFO via shared-registry releases the
 * adapter binding and command handlers on shutdown.
 */
export default function initSpecStore(ctx: Record<string, unknown>): () => Promise<void> {
  const [register, cleanup] = newRegistry();
  const workspace = getWorkspace(ctx);
  const store = workspace.requireAdapter(SpecStore);
  const commands = workspace.requireAdapter(Commands);

  register(
    commands.listen(CreateSpecCommand, (command) => {
      const { catalogId, spec, meta } = command.payload;
      const specId = store.create({ catalogId, spec, meta });
      command.resolve({ specId });
      return true;
    }),
  );

  register(
    commands.listen(PatchSpecCommand, (command) => {
      const { specId, patch } = command.payload;
      store.patch(specId, patch);
      command.resolve();
      return true;
    }),
  );

  return cleanup;
}
