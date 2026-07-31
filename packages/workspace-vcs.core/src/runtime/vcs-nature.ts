import type { Git } from "@statewalker/vcs-commands";
import {
  type Project,
  ProjectAdapter,
  type Secrets,
  type Workspace,
} from "@statewalker/workspace.core";
import type { VcsConfigData } from "../config/index.js";

/** The HTTP transport the nature's remote operations run on. */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Everything the VCS nature cannot get from a `Project`, injected at registration. */
export interface VcsDeps {
  fetch: FetchFn;
  secrets?: Secrets;
}

/** The VCS nature of a project, as a façade project adapter. */
export class VcsNature extends ProjectAdapter {
  constructor(project: Project, _deps?: VcsDeps) {
    super(project);
  }

  requireDeps(): VcsDeps {
    throw new Error("not implemented");
  }

  exists(): Promise<boolean> {
    throw new Error("not implemented");
  }

  init(_config?: Omit<VcsConfigData, "version">): Promise<void> {
    throw new Error("not implemented");
  }

  git(): Promise<Git> {
    throw new Error("not implemented");
  }
}

/** Resolve the VCS nature from a project. */
export function vcsNatureOf(_project: Project): VcsNature {
  throw new Error("not implemented");
}

/** Register the VCS nature's adapters on a workspace. */
export function registerVcs(_workspace: Workspace, _deps: VcsDeps): void {
  throw new Error("not implemented");
}
