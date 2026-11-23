# @statewalker/fragment-build.core

## What it is

Fragment authoring, the part that runs anywhere. A fragment author writes one `fragment.config.ts`; `generateFragmentFiles` turns it into every file the kernel reads: `fragment.jsonc`, `fragment.client.jsonc`, `fragment.agent.jsonc`, `fragment.server.jsonc` when the server aspect opens points or contributes extensions, `wrangler.jsonc`, and the OpenAPI command catalogue `openapi.json`. Commands' schemas are written in Zod and come out as OpenAPI 3.1 operations, the ones `system.commands` calls. `packArchive` packs a built folder into one archive identified by its content hash, and `readArchive` gives back the kernel's install input, with no build step. No React, no DOM, no Node built-ins. The Node side (loading the config, reading and writing folders, the `fragment-build` command) is [fragment-build.node](../fragment-build.node). Private for now, like kernel.core.

## Why it exists

ADR `2026-11-18-fragment-manifest-and-extension-points` (statewalker-root) gives a fragment one file per aspect, every one carrying a versioned `$schema`, with an optional `fragment.config.ts` generating them all: the generated JSON is the contract, and hand-written JSON is just as good. It also packs the built folder as one archive identified by its content hash, installed without a build. ADR `2026-11-21-commands-exposures-and-agents` makes a command one OpenAPI operation with opt-in exposures, and a fragment's `openapi.json` its complete catalogue. This package is that generator and that archive (statewalker-root#251).

## How to use

```ts
import {
  defineFragment,
  generateFragmentFiles,
  openApiCatalogue,
  packArchive,
  readArchive,
  serializeArchive,
} from "@statewalker/fragment-build.core";
```

| Export | Provides |
| --- | --- |
| `defineFragment(config)`, `FragmentConfig`, `AspectConfig`, `ServerConfig`, `CommandConfig`, ... | Types a `fragment.config.ts`'s default export. |
| `generateFragmentFiles(config)` | The generated files by root file name, as text. |
| `commandOperation(id, command)`, `commandData`, `commandExtensions(config)`, `COMMANDS_POINT` | A command's OpenAPI operation, its `commands` extension data, all of a config's. |
| `openApiCatalogue(config)`, `CATALOGUE_FILE` | The `openapi.json` catalogue (`undefined` without commands). |
| `toJsonSchema(schema, io)` | A Zod schema (or JSON Schema, as it is) as JSON Schema 2020-12. |
| `packArchive(files)`, `serializeArchive(archive)`, `readArchive(text)`, `isArchivePath(path)`, `FragmentArchive` | The content-hashed archive (hashed with kernel.core's `archiveHash`). |
| `aspectDir(config, aspect)`, `DEFAULT_DIRS`, `DEFAULT_KERNEL_SCHEMAS`, `DEFAULT_WRANGLER_SCHEMA`, `DEFAULT_ARCHIVE_SCHEMA`, `WRANGLER_FILE` | Folders and `$schema` defaults. |
| `@statewalker/fragment-build.core/schemas/fragment-archive.v1.schema.json` | The archive document's schema. |

`zod` (4) is a peer dependency: the config imports it, and `z.toJSONSchema` converts its schemas.

## Examples

A `fragment.config.ts`:

```ts
import { defineFragment } from "@statewalker/fragment-build.core";
import { z } from "zod";

export default defineFragment({
  id: "org.example.notes",
  version: "1.0.0",
  engines: { platform: "^1.0.0" },
  bindings: ["durable-objects"],
  server: {
    compatibilityDate: "2025-01-01",
    durableObjects: [{ name: "NOTES", className: "Notes" }],
    migrations: [{ tag: "v1", new_sqlite_classes: ["Notes"] }],
  },
  client: {
    dir: "web",
    extensionPoints: {
      exporters: { description: "Ways to export a note", schema: z.object({ label: z.string() }) },
    },
  },
  commands: {
    "get-note": {
      summary: "Read a note",
      input: z.object({ id: z.string() }),
      output: z.object({ text: z.string() }),
      errors: { "not-found": { status: 404, data: z.object({ id: z.string() }) } },
      exposures: { agent: { action: "read" }, http: { path: "/notes/get" } },
      labels: { fr: { title: "Lire une note" } },
      handler: { entrypoint: "default", method: "getNote" },
    },
  },
});
```

It generates, among others, a standard `wrangler.jsonc`:

```jsonc
// Generated from fragment.config.ts: edit the config, not this file.
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "org-example-notes",
  "main": "server/index.ts",
  "compatibility_date": "2025-01-01",
  "durable_objects": { "bindings": [{ "name": "NOTES", "class_name": "Notes" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Notes"] }]
}
```

and in `fragment.client.jsonc` the command as an extension of `system.commands`' point:

```jsonc
{
  "point": "commands",
  "data": {
    "operation": {
      "operationId": "get-note",
      "summary": "Read a note",
      "requestBody": { "required": true, "content": { "application/json": { "schema": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] } } } },
      "responses": {
        "200": { "description": "The command's result", "content": { "application/json": { "schema": { "...": "the output" } } } },
        "404": { "description": "not-found", "content": { "application/json": { "schema": { "type": "object", "required": ["code", "data"], "properties": { "code": { "const": "not-found" }, "message": { "type": "string" }, "data": { "...": "" } } } } } }
      }
    },
    "exposures": { "agent": { "action": "read" }, "http": { "path": "/notes/get" } },
    "labels": { "fr": { "title": "Lire une note" } }
  },
  "reference": { "entrypoint": "default", "method": "getNote" }
}
```

Pack a built folder's files and install the archive:

```ts
const archive = await packArchive(files); // { hash: "sha256:…", files }
const text = serializeArchive(archive); // one JSON document, byte-identical for the same files
// ... later, on any host:
await kernel.install([await readArchive(text)]); // hash checked; no build
```

## Internals

### Generated files

- **`fragment.jsonc`**: id, version, name, description, `requires`, `engines`, `bindings`, and the aspects present, each with `dir` only when it overrides the default (`server/`, `client/`, `agent/`; agent plugins sit in `agent/<plugin>/`). A fragment with commands has a client aspect even when the config declares none.
- **`fragment.<aspect>.jsonc`**: the aspect's `extensionPoints` (schemas converted from Zod) and `extensions`; commands are appended to the client aspect's extensions. `fragment.client.jsonc` and `fragment.agent.jsonc` are written for each aspect present, `fragment.server.jsonc` only when the server aspect has points or extensions.
- **`wrangler.jsonc`**: unchanged standard wrangler. `name` is kernel.core's `workerNameOf(id)` (dots to hyphens), so the installer's check holds; `main` is the server folder plus `server.main` (default `index.ts`); `compatibility_date` is required in the config, so a build never depends on the day it runs; `compatibility_flags`, `durable_objects` and `migrations` come from the config, and `server.wrangler` carries any other standard key (the generated ones cannot be overridden there).
- **`openapi.json`**: see below.

Each JSONC file starts with a comment saying it is generated. `$schema` defaults to kernel.core's schemas under `./node_modules/@statewalker/kernel.core/schemas/` (`fragment.v1`, `fragment-aspect.v1`) and wrangler's `./node_modules/wrangler/config-schema.json`; `schemas: { kernel, wrangler }` in the config moves them, since the kernel reads the version from the file name alone. Output is deterministic: keys in a fixed order, records in declaration order.

### Commands

A command's operation has `operationId` the command id, a required JSON request body whose schema is the input (Zod's input side; an empty closed object without `input`), a `200` response with the output schema (Zod's output side; no content without `output`), and one response per error status. An error's body schema is `{ code: { const }, message?, data? }`, `data` from the error's schema; errors sharing a status share the response, `code` becoming an `enum` and each code's body one branch of a `oneOf`. The default status is `400`; a status must be 4xx or 5xx. An input that is not an object schema is refused. Zod objects are open on the input side (Zod strips unknown keys), so the bus accepts extra keys unless the author uses `z.strictObject`; the harness projection closes inputs itself.

### The catalogue

`openapi.json` is an OpenAPI 3.1 document: `info` (the fragment's name or id, its version), `x-fragment` (the id) and one `POST` per command, at its `http` path or at `/commands/<command-id>` (the path `system.commands` gives an `mcp` exposure without one). Each operation is exactly the one its `commands` extension declares, plus `x-exposures` and `x-labels`. It is written only for a fragment with commands, beside `wrangler.jsonc`, and the host serves it as the fragment's `.well-known/openapi.json`.

### The archive

An archive is the built folder's files by relative POSIX path, as UTF-8 text: the same map the kernel installs (`FragmentFiles`). The kernel reads the root files and keeps the rest for the host. Its hash is `sha256:` and the lowercase hex SHA-256 (Web Crypto) of the UTF-8 JSON text of `[[path, text], ...]` sorted by path in JavaScript string order: kernel.core's `archiveHash` (statewalker-root#249), imported from kernel.core, so an archive's hash is its key in the host's archive store (`ArchiveStore`). The same files always hash the same, whatever order or file times they were read with.

The serialized form is one JSON document (`fragment-archive.v1.schema.json`): `$schema`, `hash` and `files` sorted by path. `readArchive` refuses an unknown `$schema` version, a path that is absolute, has a backslash, an empty, `.` or `..` segment, and files whose hash differs from the document's. Version 1 carries text files only; binary assets (images, wasm) would need an encoding (base64 entries, or a zip) and a hash definition over bytes, which is left for confirmation.

### Dependencies

- `@statewalker/kernel.core`: aspect names, file names, `workerNameOf`, `archiveHash`, the install input type.
- `zod` (peer, 4): `z.toJSONSchema`, JSON Schema 2020-12.

## License

MIT. See [LICENSE](../../LICENSE).
