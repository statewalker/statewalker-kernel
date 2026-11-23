/**
 * The JSON Schema (2020-12) of `fragment.jsonc`, version 1. The package ships the same
 * document as `schemas/fragment.v1.schema.json` (a test keeps the two equal), so authors
 * point `$schema` at it, from npm or from wherever a distribution serves it.
 *
 * The kernel reads a manifest's version from the file name its `$schema` ends with
 * (`fragment.v<N>.schema.json`), not from a fixed URL: the URL stays neutral and each
 * distribution may host the file where it likes.
 */
export const fragmentManifestSchemaV1 = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Fragment manifest (fragment.jsonc), version 1",
  type: "object",
  required: ["$schema", "id", "version", "engines", "aspects"],
  additionalProperties: false,
  properties: {
    $schema: {
      description: "The URL or path of this schema; its file name carries the version.",
      type: "string",
      pattern: "(^|/)fragment\\.v1\\.schema\\.json$",
    },
    id: {
      description:
        "Reverse-domain id, never changed (org.example.fragment-notes); system.* is reserved for the platform's core fragments.",
      type: "string",
      minLength: 1,
    },
    version: { description: "The fragment's version (semver).", type: "string", minLength: 1 },
    name: { type: "string" },
    description: { type: "string" },
    requires: {
      description: "Required fragments: fragment id to a semver range.",
      type: "object",
      additionalProperties: { type: "string", minLength: 1 },
    },
    engines: {
      type: "object",
      required: ["platform"],
      additionalProperties: false,
      properties: {
        platform: {
          description: "The platform versions this fragment runs on (a semver range).",
          type: "string",
          minLength: 1,
        },
      },
    },
    bindings: {
      description: "Bindings the host must offer.",
      type: "array",
      items: { type: "string", minLength: 1 },
      uniqueItems: true,
    },
    aspects: {
      description:
        "The aspects present. The platform fixes them: server (wrangler.jsonc), client and agent.",
      type: "object",
      additionalProperties: false,
      properties: {
        server: { $ref: "#/$defs/aspect" },
        client: { $ref: "#/$defs/aspect" },
        agent: { $ref: "#/$defs/aspect" },
      },
    },
  },
  $defs: {
    aspect: {
      type: "object",
      additionalProperties: false,
      properties: {
        dir: {
          description: "The aspect's folder, when not the default (server/, client/, agent/).",
          type: "string",
          minLength: 1,
        },
      },
    },
  },
} as const;

/**
 * The JSON Schema (2020-12) of an aspect file, version 1: `fragment.client.jsonc`,
 * `fragment.agent.jsonc` and `fragment.server.jsonc` (the server aspect's points and
 * extensions, beside its unchanged `wrangler.jsonc`). The package ships the same document
 * as `schemas/fragment-aspect.v1.schema.json`; as for the manifest, the version comes from
 * the file name the `$schema` ends with (`fragment-aspect.v<N>.schema.json`).
 */
export const fragmentAspectSchemaV1 = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Fragment aspect file (fragment.<aspect>.jsonc), version 1",
  type: "object",
  required: ["$schema"],
  additionalProperties: false,
  properties: {
    $schema: {
      description: "The URL or path of this schema; its file name carries the version.",
      type: "string",
      pattern: "(^|/)fragment-aspect\\.v1\\.schema\\.json$",
    },
    extensionPoints: {
      description:
        "The extension points this fragment opens in the aspect, by name. A point's id is <fragment-id>/<name>; a core fragment's point is known by its short name alone.",
      type: "object",
      propertyNames: { $ref: "#/$defs/pointName" },
      additionalProperties: { $ref: "#/$defs/extensionPoint" },
    },
    extensions: {
      description: "This fragment's extensions to points of the same aspect.",
      type: "array",
      items: { $ref: "#/$defs/extension" },
    },
  },
  $defs: {
    pointName: {
      description: "An extension point's name: lowercase letters, digits and inner hyphens.",
      type: "string",
      pattern: "^[a-z](?:[a-z0-9-]*[a-z0-9])?$",
    },
    pointId: {
      description:
        "An extension point's id: <fragment-id>/<name>, or a core point's short name alone.",
      type: "string",
      pattern:
        "^(?:[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z](?:[a-z0-9-]*[a-z0-9])?)+/)?[a-z](?:[a-z0-9-]*[a-z0-9])?$",
    },
    extensionPoint: {
      type: "object",
      required: ["schema"],
      additionalProperties: false,
      properties: {
        description: { type: "string" },
        schema: {
          description: "The JSON Schema (2020-12) every extension's data must match.",
          type: ["object", "boolean"],
        },
      },
    },
    extension: {
      type: "object",
      required: ["point", "data"],
      additionalProperties: false,
      properties: {
        point: { $ref: "#/$defs/pointId" },
        data: { description: "The extension's data, checked against the point's schema." },
        reference: { $ref: "#/$defs/reference" },
      },
    },
    reference: {
      description:
        "A lazy reference to the contributor's code, handed only to the point's owner: a client module export, a server entrypoint method, or a command.",
      oneOf: [
        {
          type: "object",
          required: ["module"],
          additionalProperties: false,
          properties: {
            module: {
              description: "A module of the contributor's aspect folder.",
              type: "string",
              minLength: 1,
            },
            export: {
              description: "The export's name; default when absent.",
              type: "string",
              minLength: 1,
            },
          },
        },
        {
          type: "object",
          required: ["entrypoint", "method"],
          additionalProperties: false,
          properties: {
            entrypoint: {
              description: "The server half's entrypoint, reached through a service binding.",
              type: "string",
              minLength: 1,
            },
            method: { type: "string", minLength: 1 },
          },
        },
        {
          type: "object",
          required: ["command"],
          additionalProperties: false,
          properties: { command: { type: "string", minLength: 1 } },
        },
      ],
    },
  },
} as const;
