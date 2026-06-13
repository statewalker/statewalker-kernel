import type { FilesApi } from "@statewalker/webrun-files";
import type { WorkspaceAdapter } from "./workspace.js";

/**
 * Abstract adapter token for the workspace system subtree. The concrete
 * implementation exposes a `FilesApi` rooted at the system directory
 * (typically `.settings/`), where per-fragment state (secrets, settings,
 * model weights, session history) lives.
 *
 * Consumers import this class as both a type and a runtime token:
 * `workspace.requireAdapter(SystemFiles)` returns an instance shaped by the
 * concrete subclass.
 */
export abstract class SystemFiles implements WorkspaceAdapter {
  abstract readonly files: FilesApi;
  init?(): void | Promise<void>;
  close?(): void | Promise<void>;
}
