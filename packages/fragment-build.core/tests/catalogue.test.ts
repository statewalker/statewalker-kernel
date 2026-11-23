import { parseJsonc } from "@statewalker/kernel.core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFragment, generateFragmentFiles } from "../src/index.js";
import { platform } from "./helpers.js";

const config = defineFragment({
  id: "org.example.notes",
  version: "2.0.0",
  name: "Notes",
  engines: { platform: "^1.0.0" },
  commands: {
    "get-note": {
      summary: "Read a note",
      input: z.object({ id: z.string() }),
      output: z.object({ text: z.string() }),
      exposures: { agent: { action: "read" }, http: { path: "/notes/get" }, mcp: {} },
      labels: { fr: { title: "Lire une note" } },
      handler: { module: "./commands.js", export: "getNote" },
    },
    "list-notes": { exposures: { mcp: {} } },
    reindex: {},
  },
});

function parsed(text: string | undefined): Record<string, unknown> {
  const { value, error } = parseJsonc(text ?? "");
  if (error) throw new Error(error);
  return value as Record<string, unknown>;
}

describe("the OpenAPI catalogue", () => {
  it("lists every command as the operation system.commands consumes, exposures beside it", async () => {
    const files = generateFragmentFiles(config);
    const catalogue = parsed(files["openapi.json"]);
    const client = parsed(files["fragment.client.jsonc"]) as {
      extensions: { data: { operation: Record<string, unknown> } }[];
    };
    const operations = client.extensions.map((e) => e.data.operation);

    expect(catalogue.openapi).toBe("3.1.0");
    expect(catalogue.info).toEqual({ title: "Notes", version: "2.0.0" });
    expect(catalogue["x-fragment"]).toBe("org.example.notes");
    const paths = catalogue.paths as Record<string, { post: Record<string, unknown> }>;
    expect(Object.keys(paths)).toEqual(["/notes/get", "/commands/list-notes", "/commands/reindex"]);
    const posts = Object.values(paths).map(({ post }) => post);
    expect(
      posts.map((post) =>
        Object.fromEntries(Object.entries(post).filter(([k]) => !k.startsWith("x-"))),
      ),
    ).toEqual(operations);
    expect(posts.map((post) => post["x-exposures"])).toEqual([
      { agent: { action: "read" }, http: { path: "/notes/get" }, mcp: {} },
      { mcp: {} },
      undefined,
    ]);
    expect(posts[0]?.["x-labels"]).toEqual({ fr: { title: "Lire une note" } });

    // The archive still installs with the catalogue beside the manifest.
    const { installed } = await platform([files]);
    expect(installed[0]?.files["openapi.json"]).toBe(files["openapi.json"]);
  });

  it("is not written for a fragment without commands", () => {
    const files = generateFragmentFiles(
      defineFragment({ id: "org.example.empty", version: "1.0.0", engines: { platform: "*" } }),
    );
    expect(Object.keys(files)).toEqual(["fragment.jsonc"]);
  });
});
