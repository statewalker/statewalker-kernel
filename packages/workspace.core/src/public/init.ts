import { Commands } from "@statewalker/shared-commands";
import { registerChangeWorkspaceHandler } from "../internal/change-workspace.handler.js";
import { getWorkspace } from "./types/index.js";

export default function init(ctx: Record<string, unknown>): () => void {
  const workspace = getWorkspace(ctx);
  const commands = workspace.requireAdapter(Commands);
  return registerChangeWorkspaceHandler({ commands, workspace });
}
