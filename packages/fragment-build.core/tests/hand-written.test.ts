import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFragment, generateFragmentFiles } from "../src/index.js";
import { platform } from "./helpers.js";

const ID = "org.example.greeter";

const config = defineFragment({
  id: ID,
  version: "1.0.0",
  engines: { platform: "^1.0.0" },
  commands: {
    greet: {
      input: z.object({ name: z.string() }),
      output: z.object({ text: z.string() }),
      handler: { module: "./commands.js", export: "greet" },
    },
  },
});

// The same fragment written by hand: comments, trailing commas, its own layout.
const handWritten = {
  "fragment.jsonc": `{
    // written by hand
    "$schema": "./node_modules/@statewalker/kernel.core/schemas/fragment.v1.schema.json",
    "id": "${ID}", "version": "1.0.0",
    "engines": { "platform": "^1.0.0" },
    "aspects": { "client": {} },
  }`,
  "fragment.client.jsonc": `{
    "$schema": "./node_modules/@statewalker/kernel.core/schemas/fragment-aspect.v1.schema.json",
    "extensions": [{
      "point": "commands",
      "reference": { "module": "./commands.js", "export": "greet" },
      "data": { "operation": {
        "operationId": "greet",
        "requestBody": { "required": true, "content": { "application/json": { "schema": {
          "type": "object", "properties": { "name": { "type": "string" } },
          "required": ["name"],
        } } } },
        "responses": { "200": { "description": "The command's result", "content": {
          "application/json": { "schema": {
            "type": "object", "properties": { "text": { "type": "string" } },
            "required": ["text"], "additionalProperties": false,
          } } } } },
      } },
    }],
  }`,
};

const handlers = { [ID]: { greet: ({ name }: { name: string }) => ({ text: `hi ${name}` }) } };

describe("hand-written JSON", () => {
  it("is installed and called exactly as the generated files are", async () => {
    const generated = await platform([generateFragmentFiles(config)], handlers);
    const hand = await platform([handWritten], handlers);
    const [g] = generated.installed;
    const [h] = hand.installed;
    expect(h?.manifest).toEqual(g?.manifest);
    expect(h?.aspects).toEqual(g?.aspects);
    for (const { bus } of [generated, hand]) {
      await expect(bus.call(`${ID}/greet`, { name: "ann" })).resolves.toEqual({ text: "hi ann" });
      await expect(bus.call(`${ID}/greet`, {})).rejects.toMatchObject({ kind: "invalid-input" });
    }
  });
});
