import { newAdapter } from "@statewalker/shared-adapters";
import { type FilesApi, normalizePath } from "@statewalker/webrun-files";
import { LRU, type LruCache } from "../../internal/lru.js";
import { Adaptable, type AdaptableAdapter } from "./adaptable.js";
import { AdaptersRegistry } from "./adapters-registry.js";
import { Project } from "./project.js";
import { Resource } from "./resource.js";

export const [getWorkspace, , resetWorkspace] = newAdapter<Workspace>(
  "workspace:workspace",
  () => new Workspace(),
);

// Re-exported for backward compatibility — these moved to ./adapters-registry.
export type {
  AdapterCtor,
  AdapterFactory,
  AdapterLevel,
  ConcreteAdapterCtor,
} from "./adapters-registry.js";
export { AdaptersRegistry } from "./adapters-registry.js";

/**
 * Optional teardown hook an adapter MAY expose (alias of `AdaptableAdapter`).
 * Called when an existing instance is explicitly replaced via `setAdapter`.
 * Adapter instances are otherwise stable across `open()` / `close()` cycles —
 * adapters that need to react to those transitions subscribe via
 * `workspace.onLoad` / `onUnload`.
 */
export type WorkspaceAdapter = AdaptableAdapter;

/**
 * Observable workspace the shell app and every fragment share. Extends
 * `Adaptable` (the class-keyed, observable adapter host) and additionally owns
 * the single primary `FilesApi`, the open/close lifecycle, and — as the root of
 * the workspace → project → resource hierarchy — the shared `AdaptersRegistry`.
 *
 * Lifecycle: constructed closed; adapters and the file system are installed via
 * chainable `setAdapter` / `setFileSystem`; `open()` transitions live. Consumers
 * subscribe via `onLoad` / `onUnload`; `BaseClass.onUpdate` fires on any state
 * transition including `setFileSystem` rebinds. `close()` flips the state and
 * fires onUnload listeners but does NOT tear down adapter instances — the
 * registry is stable across cycles.
 */
export class Workspace extends Adaptable {
  private _isOpened = false;
  private _files: FilesApi | null = null;
  private _label = "";
  private readonly _registry = new AdaptersRegistry();

  private readonly _resources: LruCache<Promise<Resource | null>> = new LRU({ max: 1000 });
  private readonly _projects: LruCache<Promise<Project | null>> = new LRU({ max: 256 });

  private readonly _onLoadListeners = new Set<() => void | Promise<void>>();
  private readonly _onUnloadListeners = new Set<() => void | Promise<void>>();

  /** This handle resolves workspace-level adapter factories. */
  protected get adapterLevel() {
    return "workspace" as const;
  }

  /** The shared registry that `Project`/`Resource` handles also consult. */
  get adaptersRegistry(): AdaptersRegistry {
    return this._registry;
  }

  get isOpened(): boolean {
    return this._isOpened;
  }

  get label(): string {
    return this._label;
  }

  get files(): FilesApi {
    if (!this._files) {
      throw new Error("Workspace has no file system installed — call setFileSystem() first");
    }
    return this._files;
  }

  setFileSystem(files: FilesApi, label?: string): this {
    if (this._isOpened) {
      throw new Error("Workspace.setFileSystem is only legal while closed — call close() first");
    }
    this._files = files;
    if (label !== undefined) this._label = label;
    this.notify();
    return this;
  }

  onLoad(cb: () => void | Promise<void>): () => void {
    if (this._isOpened) {
      try {
        void cb();
      } catch (err) {
        logListenerError("onLoad", err);
      }
    }
    this._onLoadListeners.add(cb);
    return () => {
      this._onLoadListeners.delete(cb);
    };
  }

  onUnload(cb: () => void | Promise<void>): () => void {
    this._onUnloadListeners.add(cb);
    return () => {
      this._onUnloadListeners.delete(cb);
    };
  }

  async open(): Promise<this> {
    if (this._isOpened) return this;
    if (!this._files) {
      throw new Error("Workspace.open requires a file system — call setFileSystem() first");
    }
    this._isOpened = true;
    this.notify();
    for (const listener of this._onLoadListeners) {
      try {
        await listener();
      } catch (err) {
        logListenerError("onLoad", err);
      }
    }
    return this;
  }

  async close(): Promise<void> {
    if (!this._isOpened) return;
    this._isOpened = false;
    for (const listener of this._onUnloadListeners) {
      try {
        await listener();
      } catch (err) {
        logListenerError("onUnload", err);
      }
    }
    this.notify();
  }

  /**
   * Resolve a `Resource` for a path under the `FilesApi`, cached by full path.
   * Returns `null` when the path is absent and `create` is false.
   */
  getResource(path: string, create = false): Promise<Resource | null> {
    const key = normalizePath(path);
    let promise = this._resources.get(key);
    if (!promise) {
      promise = (async () => {
        const stats = await this.files.stats(key);
        if (!stats && !create) return null;
        return new Resource(this, key);
      })().catch((err) => {
        if (this._resources.get(key) === promise) this._resources.del(key);
        throw err;
      });
      this._resources.set(key, promise);
    }
    return promise;
  }

  /**
   * Resolve a `Project` for a top-level directory, cached by project name.
   * Returns `null` when the directory is absent and `create` is false.
   */
  getProject(name: string, create = false): Promise<Project | null> {
    let promise = this._projects.get(name);
    if (!promise) {
      promise = (async () => {
        const dir = await this.getResource(name, create);
        if (!dir) return null;
        return new Project(this, dir);
      })().catch((err) => {
        if (this._projects.get(name) === promise) this._projects.del(name);
        throw err;
      });
      this._projects.set(name, promise);
    }
    return promise;
  }

  /** Yield one `Project` per top-level directory under the `FilesApi`. */
  async *listProjects(): AsyncGenerator<Project> {
    for await (const info of this.files.list("/")) {
      if (info.kind !== "directory") continue;
      const project = await this.getProject(info.name);
      if (project) yield project;
    }
  }

  /** Collect every top-level `Project` into an array. */
  async getProjects(): Promise<Project[]> {
    const projects: Project[] = [];
    for await (const project of this.listProjects()) projects.push(project);
    return projects;
  }
}

function logListenerError(scope: string, err: unknown): void {
  console.error(`[workspace] ${scope} listener threw:`, err);
}
