import type { FilesApi } from "@statewalker/webrun-files";
import type { AdapterCtor } from "../types/adapters-registry.js";
import type { Resource } from "../types/resource.js";
import type { Workspace } from "../types/workspace.js";

/**
 * Base for adapters hosted on a `Resource`. Self-hostable: the `Adaptable`
 * resolver constructs `new SomeResourceAdapter(resource)`, so concrete subclasses
 * resolve on any resource without explicit registration. A factory may also pass
 * registration-time `options`. Delegates adapter lookups to the host resource so
 * sibling adapters share one per-resource cache.
 */
export class ResourceAdapter {
  readonly options: Record<string, unknown>;

  constructor(
    readonly resource: Resource,
    options: Record<string, unknown> = {},
  ) {
    this.options = options;
  }

  get workspace(): Workspace {
    return this.resource.workspace;
  }

  get filesApi(): FilesApi {
    return this.resource.workspace.files;
  }

  get path(): string {
    return this.resource.path;
  }

  getAdapter<T>(type: AdapterCtor<T>): T | null {
    return this.resource.getAdapter(type);
  }

  requireAdapter<T>(type: AdapterCtor<T>): T {
    return this.resource.requireAdapter(type);
  }
}
