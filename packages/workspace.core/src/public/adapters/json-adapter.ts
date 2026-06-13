import { newReference, type Reference } from "../../internal/references.js";
import { ResourceAdapter } from "./resource-adapter.js";
import { TextAdapter } from "./text-adapter.js";

/** A JSON value: the result of `JSON.parse` / the input to `JSON.stringify`. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * Parses a resource's text as JSON, exposed as `jsonRef` — a `Reference` that
 * depends on `TextAdapter.textRef`, so it recomputes whenever the text changes.
 */
export class JsonAdapter extends ResourceAdapter {
  private _jsonRef?: Reference<{ value: Promise<Json> }>;

  get jsonRef(): Reference<{ value: Promise<Json> }> {
    const textAdapter = this.requireAdapter(TextAdapter);
    if (!this._jsonRef) {
      this._jsonRef = newReference([textAdapter.textRef], () => {
        const promise = (async () => JSON.parse(await textAdapter.getText()) as Json)();
        return { value: promise };
      });
    }
    return this._jsonRef;
  }

  async getJson(): Promise<Json> {
    return this.jsonRef().value;
  }

  async setJson(json: Json): Promise<void> {
    this.jsonRef.reset();
    await this.requireAdapter(TextAdapter).setText(JSON.stringify(json, null, 2));
  }
}
