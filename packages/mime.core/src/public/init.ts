import { newRegistry } from "@statewalker/shared-registry";
import { getWorkspace } from "@statewalker/workspace";
import { FilesManager } from "../internal/files.manager.js";

/**
 * Logic-fragment init for `files`. Constructs `FilesManager`, which
 * handles `files:visualize` (mime-renderer dispatch into a dock panel).
 * Per ADR 0002 (logic-only): no React imports.
 *
 * The primitive `files:*` filesystem commands are owned by
 * `@statewalker/workspace` and booted via its `./files-fragment` root.
 * The built-in agent file tools are installed by the agent-runtime
 * builder, so this fragment no longer contributes to `agent:tools`.
 */
export default function initFiles(ctx: Record<string, unknown>): () => Promise<void> {
  const workspace = getWorkspace(ctx);

  const [register, cleanup] = newRegistry();
  const manager = new FilesManager({ workspace });
  register(() => manager.close());

  return cleanup;
}
