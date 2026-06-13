import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it } from "vitest";
import { JsonAdapter } from "../public/adapters/json-adapter.js";
import { TextAdapter } from "../public/adapters/text-adapter.js";
import type { Resource } from "../public/types/resource.js";
import { Workspace } from "../public/types/workspace.js";

const enc = new TextEncoder();

async function res(path: string, body: string): Promise<Resource> {
  const files = new MemFilesApi();
  await files.write(path, [enc.encode(body)]);
  const ws = new Workspace();
  ws.setFileSystem(files, "A");
  await ws.open();
  const r = await ws.getResource(path);
  if (!r) throw new Error("resource not resolved");
  return r;
}

describe("TextAdapter", () => {
  it("reads text and round-trips writes", async () => {
    const r = await res("/a.txt", "hello");
    const text = r.requireAdapter(TextAdapter);
    expect(await text.getText()).toBe("hello");

    await text.setText("world");
    expect(await text.getText()).toBe("world");
  });
});

describe("JsonAdapter — depends on TextAdapter via Reference", () => {
  it("parses json and recomputes when the underlying text changes", async () => {
    const r = await res("/a.json", JSON.stringify({ n: 1 }));
    const json = r.requireAdapter(JsonAdapter);
    expect(await json.getJson()).toEqual({ n: 1 });

    // Mutate through the shared TextAdapter; jsonRef depends on textRef and must recompute.
    await r.requireAdapter(TextAdapter).setText(JSON.stringify({ n: 2 }));
    expect(await json.getJson()).toEqual({ n: 2 });
  });

  it("setJson writes through to text", async () => {
    const r = await res("/a.json", "{}");
    await r.requireAdapter(JsonAdapter).setJson({ ok: true });
    expect(await r.requireAdapter(TextAdapter).getText()).toBe(
      JSON.stringify({ ok: true }, null, 2),
    );
  });
});
