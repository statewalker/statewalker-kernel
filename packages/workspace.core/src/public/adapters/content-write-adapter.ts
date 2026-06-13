import { ResourceAdapter } from "./resource-adapter.js";

/** Writes a resource's bytes / text via the workspace `FilesApi`. */
export class ContentWriteAdapter extends ResourceAdapter {
  async writeContent(content: Iterable<Uint8Array> | AsyncIterable<Uint8Array>): Promise<void> {
    await this.workspace.files.write(this.path, content);
  }

  async writeText(content: string | AsyncIterable<string | Uint8Array>): Promise<void> {
    const source = typeof content === "string" ? [content] : content;
    const encoder = new TextEncoder();
    const bytes = (async function* () {
      for await (const chunk of source as AsyncIterable<string | Uint8Array>) {
        yield typeof chunk === "string" ? encoder.encode(chunk) : chunk;
      }
    })();
    await this.writeContent(bytes);
  }
}
