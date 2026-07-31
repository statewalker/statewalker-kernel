import { type Project, ProjectAdapter } from "@statewalker/workspace.core";

/** The VCS nature's marker / config file, under the project system folder. */
export const VCS_NATURE_FILE = "nature.vcs.json";

/** The per-project VCS configuration, as persisted in `.project/nature.vcs.json`. */
export interface VcsConfigData {
  version: 1;
  defaultRemote?: string;
  author?: { name: string; email: string };
}

export class VcsConfiguration extends ProjectAdapter {
  async exists(): Promise<boolean> {
    throw new Error("not implemented");
  }

  async load(): Promise<this> {
    throw new Error("not implemented");
  }

  async write(_cfg: VcsConfigData): Promise<void> {
    throw new Error("not implemented");
  }

  get data(): VcsConfigData {
    throw new Error("not implemented");
  }
}

export function vcsConfigOf(_project: Project): VcsConfiguration {
  throw new Error("not implemented");
}
