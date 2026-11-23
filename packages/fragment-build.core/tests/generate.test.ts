import { extensionRefusalsSlot, parseJsonc } from "@statewalker/kernel.core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFragment, generateFragmentFiles } from "../src/index.js";
import { platform } from "./helpers.js";

const KERNEL_SCHEMAS = "./node_modules/@statewalker/kernel.core/schemas";

function json(files: Record<string, string>, name: string): Record<string, unknown> {
  const text = files[name];
  if (text === undefined) throw new Error(`no ${name}`);
  const { value, error } = parseJsonc(text);
  if (error) throw new Error(`${name}: ${error}`);
  return value as Record<string, unknown>;
}

describe("generateFragmentFiles", () => {
  it("writes a fragment.jsonc with its versioned $schema that the kernel installs", async () => {
    const config = defineFragment({
      id: "org.example.hello",
      version: "1.2.3",
      name: "Hello",
      engines: { platform: "^1.0.0" },
      client: {},
    });
    const files = generateFragmentFiles(config);
    expect(json(files, "fragment.jsonc")).toEqual({
      $schema: `${KERNEL_SCHEMAS}/fragment.v1.schema.json`,
      id: "org.example.hello",
      version: "1.2.3",
      name: "Hello",
      engines: { platform: "^1.0.0" },
      aspects: { client: {} },
    });
    const { installed } = await platform([files]);
    expect(installed.map((f) => [f.id, f.manifest.version])).toEqual([
      ["org.example.hello", "1.2.3"],
    ]);
  });

  it("writes a dir only when it overrides the default, and the aspects' points and extensions", async () => {
    const owner = defineFragment({
      id: "org.example.notes",
      version: "1.0.0",
      engines: { platform: "^1.0.0" },
      client: {
        dir: "web",
        extensionPoints: {
          exporters: {
            description: "Ways to export a note",
            schema: z.object({ label: z.string() }),
          },
        },
      },
      agent: {},
    });
    const contributor = defineFragment({
      id: "org.example.pdf",
      version: "1.0.0",
      engines: { platform: "^1.0.0" },
      client: {
        extensions: [
          {
            point: "org.example.notes/exporters",
            data: { label: "PDF" },
            reference: { module: "./export.js", export: "exportPdf" },
          },
        ],
      },
    });
    const ownerFiles = generateFragmentFiles(owner);
    expect(json(ownerFiles, "fragment.jsonc").aspects).toEqual({
      client: { dir: "web" },
      agent: {},
    });
    expect(json(ownerFiles, "fragment.agent.jsonc")).toEqual({
      $schema: `${KERNEL_SCHEMAS}/fragment-aspect.v1.schema.json`,
    });
    expect(json(ownerFiles, "fragment.client.jsonc")).toEqual({
      $schema: `${KERNEL_SCHEMAS}/fragment-aspect.v1.schema.json`,
      extensionPoints: {
        exporters: {
          description: "Ways to export a note",
          schema: {
            type: "object",
            properties: { label: { type: "string" } },
            required: ["label"],
            additionalProperties: false,
          },
        },
      },
    });
    expect(json(generateFragmentFiles(contributor), "fragment.client.jsonc")).toEqual({
      $schema: `${KERNEL_SCHEMAS}/fragment-aspect.v1.schema.json`,
      extensions: [
        {
          point: "org.example.notes/exporters",
          data: { label: "PDF" },
          reference: { module: "./export.js", export: "exportPdf" },
        },
      ],
    });

    const { kernel, installed } = await platform([ownerFiles, generateFragmentFiles(contributor)]);
    expect(installed.map((f) => f.id)).toEqual(["org.example.notes", "org.example.pdf"]);
    expect([...kernel.slots.getSnapshot(extensionRefusalsSlot("client")).values()]).toEqual([]);
  });

  it("writes the server half as standard wrangler, its Worker named from the id", async () => {
    const config = defineFragment({
      id: "org.example.counter",
      version: "0.1.0",
      engines: { platform: "^1.0.0" },
      bindings: ["durable-objects"],
      server: {
        dir: "worker",
        compatibilityDate: "2025-01-01",
        compatibilityFlags: ["nodejs_compat"],
        durableObjects: [{ name: "COUNTER", className: "Counter" }],
        migrations: [{ tag: "v1", new_sqlite_classes: ["Counter"] }],
        wrangler: { vars: { GREETING: "hi" } },
        extensions: [{ point: "org.example.notes/storage", data: { kind: "do" } }],
      },
    });
    const files = generateFragmentFiles(config);
    expect(json(files, "wrangler.jsonc")).toEqual({
      $schema: "./node_modules/wrangler/config-schema.json",
      name: "org-example-counter",
      main: "worker/index.ts",
      compatibility_date: "2025-01-01",
      compatibility_flags: ["nodejs_compat"],
      vars: { GREETING: "hi" },
      durable_objects: { bindings: [{ name: "COUNTER", class_name: "Counter" }] },
      migrations: [{ tag: "v1", new_sqlite_classes: ["Counter"] }],
    });
    expect(json(files, "fragment.server.jsonc")).toEqual({
      $schema: `${KERNEL_SCHEMAS}/fragment-aspect.v1.schema.json`,
      extensions: [{ point: "org.example.notes/storage", data: { kind: "do" } }],
    });
    expect(json(files, "fragment.jsonc").aspects).toEqual({ server: { dir: "worker" } });

    const plain = generateFragmentFiles(
      defineFragment({
        id: "org.example.plain",
        version: "0.1.0",
        engines: { platform: "^1.0.0" },
        server: { compatibilityDate: "2025-01-01", main: "main.js" },
      }),
    );
    expect(json(plain, "wrangler.jsonc")).toEqual({
      $schema: "./node_modules/wrangler/config-schema.json",
      name: "org-example-plain",
      main: "server/main.js",
      compatibility_date: "2025-01-01",
    });
    expect(plain["fragment.server.jsonc"]).toBeUndefined();

    const { installed } = await platform([files, plain]);
    expect(installed.map((f) => f.id)).toEqual(["org.example.counter", "org.example.plain"]);
  });
});
