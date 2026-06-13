import { ResourceAdapter } from "./resource-adapter.js";

/** Reads a resource's bytes / text via the workspace `FilesApi`. */
export class ContentReadAdapter extends ResourceAdapter {
  async exists(): Promise<boolean> {
    return !!(await this.workspace.files.stats(this.path));
  }

  async *readContent(): AsyncGenerator<Uint8Array> {
    yield* this.workspace.files.read(this.path);
  }

  async *readText(): AsyncGenerator<string> {
    const decoder = new TextDecoder();
    for await (const block of this.readContent()) {
      yield decoder.decode(block);
    }
  }
}
