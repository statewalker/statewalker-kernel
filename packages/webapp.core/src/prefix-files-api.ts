import type { FileInfo, FilesApi, ListOptions, ReadOptions } from "@statewalker/webrun-files";
import { joinPath, normalizePath } from "@statewalker/webrun-files";
import { DEFAULT_SYSTEM_FOLDER, type Project } from "@statewalker/workspace.core";
import { WEBAPP_CACHE_ROOT } from "./web-app-module-server.js";

/**
 * A `FilesApi` view rooted at a fixed `prefix` of an underlying `FilesApi`. Every
 * path is resolved under the prefix, and paths returned by `list` are stripped back
 * to the rooted space (leading-slash form). This is how the web-app nature roots the
 * persistent module-server cache at `<project>/.project/webapp/` and the app source at
 * the project root — over the single workspace `FilesApi` — without any dedicated
 * mount type in `webrun-files`.
 */
export class PrefixFilesApi implements FilesApi {
  private readonly prefix: string;

  constructor(
    private readonly base: FilesApi,
    prefix: string,
  ) {
    this.prefix = normalizePath(prefix);
  }

  private full(path: string): string {
    return joinPath(this.prefix, path);
  }

  private strip(fullPath: string): string {
    const n = normalizePath(fullPath);
    if (n === this.prefix) return "/";
    if (n.startsWith(`${this.prefix}/`)) return n.slice(this.prefix.length);
    return n;
  }

  read(path: string, options?: ReadOptions): AsyncIterable<Uint8Array> {
    return this.base.read(this.full(path), options);
  }

  write(path: string, content: Iterable<Uint8Array> | AsyncIterable<Uint8Array>): Promise<void> {
    return this.base.write(this.full(path), content);
  }

  mkdir(path: string): Promise<void> {
    return this.base.mkdir(this.full(path));
  }

  async *list(path: string, options?: ListOptions): AsyncIterable<FileInfo> {
    for await (const info of this.base.list(this.full(path), options)) {
      yield { ...info, path: this.strip(info.path) };
    }
  }

  stats(path: string) {
    return this.base.stats(this.full(path));
  }

  exists(path: string): Promise<boolean> {
    return this.base.exists(this.full(path));
  }

  remove(path: string): Promise<boolean> {
    return this.base.remove(this.full(path));
  }

  move(source: string, target: string): Promise<boolean> {
    return this.base.move(this.full(source), this.full(target));
  }

  copy(source: string, target: string): Promise<boolean> {
    return this.base.copy(this.full(source), this.full(target));
  }
}

/** The web-app source files, rooted at the project root (serves `client/`, `server/`, …). */
export function appFilesOf(project: Project): FilesApi {
  return new PrefixFilesApi(project.workspace.files, project.path);
}

/** The persistent module-server cache, rooted at `<project>/.project/webapp/`. */
export function cacheFilesOf(project: Project): FilesApi {
  return new PrefixFilesApi(project.workspace.files, joinPath(project.path, WEBAPP_CACHE_ROOT));
}

/** The default server application context store, rooted at `<project>/data/`. */
export function dataFilesOf(project: Project): FilesApi {
  return new PrefixFilesApi(project.workspace.files, joinPath(project.path, "data"));
}

/** The project system-folder path (`<project>/.project`), for cleanliness assertions. */
export function systemFolderOf(project: Project): string {
  return joinPath(project.path, DEFAULT_SYSTEM_FOLDER);
}
