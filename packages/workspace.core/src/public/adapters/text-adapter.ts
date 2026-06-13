import { newReference, type Reference } from "../../internal/references.js";
import { ContentReadAdapter } from "./content-read-adapter.js";
import { ContentWriteAdapter } from "./content-write-adapter.js";
import { ResourceAdapter } from "./resource-adapter.js";

/**
 * Exposes a resource's text as a weak-ref, dependency-trackable `Reference`
 * (`textRef`). Downstream adapters declare `textRef` as a dependency to
 * auto-invalidate; `setText` resets it after writing.
 */
export class TextAdapter extends ResourceAdapter {
  private _textRef?: Reference<{ value: Promise<string> }>;

  get textRef(): Reference<{ value: Promise<string> }> {
    if (!this._textRef) {
      this._textRef = newReference(() => {
        const reader = this.requireAdapter(ContentReadAdapter);
        const promise = (async () => {
          let text = "";
          for await (const chunk of reader.readText()) text += chunk;
          return text;
        })();
        return { value: promise };
      });
    }
    return this._textRef;
  }

  async getText(): Promise<string> {
    return this.textRef().value;
  }

  async setText(text: string): Promise<void> {
    await this.requireAdapter(ContentWriteAdapter).writeText(text);
    this.textRef.reset();
  }
}
