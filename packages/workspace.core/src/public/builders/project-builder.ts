import { BuildEngine } from "@statewalker/webrun-builder";
import { loggerOf } from "../types/logger.js";
import { DEFAULT_SYSTEM_FOLDER, type Project } from "../types/project.js";

/**
 * The project-level build engine, resolved via `project.requireAdapter(ProjectBuilder)`.
 * A thin adapter that binds the generic `BuildEngine<THost>` to a `Project`: files,
 * root path, system folder, and logger are read off the project, and the project
 * itself is the `host` passed to every builder handler (`handler(project)`), so a
 * project's "nature" keeps contributing builders via `registerBuilder` / a
 * `BuilderProvider` exactly as before.
 *
 * Invariant: the logger is resolved once here at construction (`loggerOf`), so the
 * host must register its `LoggerAdapter` BEFORE resolving `ProjectBuilder` — a later
 * registration is not picked up. Workspace bootstrap satisfies this ordering.
 */
export class ProjectBuilder extends BuildEngine<Project> {
  constructor(project: Project) {
    super({
      files: project.workspace.files,
      rootPath: project.path,
      systemFolder: DEFAULT_SYSTEM_FOLDER,
      logger: loggerOf(project, "ProjectBuilder"),
      host: project,
    });
  }
}
