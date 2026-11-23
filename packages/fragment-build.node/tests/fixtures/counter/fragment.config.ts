import { defineFragment } from "@statewalker/fragment-build.core";
import { z } from "zod";

export default defineFragment({
  id: "org.example.counter",
  version: "1.0.0",
  name: "Counter",
  engines: { platform: "^1.0.0" },
  bindings: ["durable-objects"],
  server: {
    compatibilityDate: "2025-01-01",
    durableObjects: [{ name: "COUNTER", className: "Counter" }],
    migrations: [{ tag: "v1", new_sqlite_classes: ["Counter"] }],
  },
  client: {},
  commands: {
    increment: {
      summary: "Add to the counter",
      input: z.object({ by: z.number().int().positive() }),
      output: z.object({ value: z.number() }),
      exposures: { http: { path: "/increment" } },
      handler: { entrypoint: "default", method: "increment" },
    },
  },
});
