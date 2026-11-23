import {
  ASPECTS,
  type Aspect,
  aspectFileOf,
  MANIFEST_FILE,
  workerNameOf,
} from "@statewalker/kernel.core";
import { CATALOGUE_FILE, commandExtensions, openApiCatalogue } from "./commands.js";
import type { AspectConfig, FragmentConfig, ServerConfig } from "./config.js";
import { toJsonSchema } from "./schema.js";

export const DEFAULT_KERNEL_SCHEMAS = "./node_modules/@statewalker/kernel.core/schemas";

export const DEFAULT_WRANGLER_SCHEMA = "./node_modules/wrangler/config-schema.json";

/** The server half's file: standard wrangler. */
export const WRANGLER_FILE = "wrangler.jsonc";

/** The default folder of each aspect. */
export const DEFAULT_DIRS: Readonly<Record<Aspect, string>> = {
  server: "server",
  client: "client",
  agent: "agent",
};

/** The folder of `aspect`: its `dir`, else the default. No trailing slash. */
export function aspectDir(config: FragmentConfig, aspect: Aspect): string {
  return (config[aspect]?.dir ?? DEFAULT_DIRS[aspect]).replace(/\/+$/, "");
}

const HEADER = "// Generated from fragment.config.ts: edit the config, not this file.\n";

function text(value: unknown): string {
  return `${HEADER}${JSON.stringify(value, null, 2)}\n`;
}

function aspectsOf(config: FragmentConfig): Partial<Record<Aspect, AspectConfig>> {
  const out: Partial<Record<Aspect, AspectConfig>> = {};
  for (const aspect of ASPECTS) {
    const value = config[aspect];
    if (value) out[aspect] = value;
  }
  // Commands are extensions of system.commands' point, which is in the client aspect.
  const commands = commandExtensions(config);
  if (commands.length > 0) {
    const client = out.client ?? {};
    out.client = { ...client, extensions: [...(client.extensions ?? []), ...commands] };
  }
  return out;
}

/** The files a `fragment.config.ts` generates, by root file name, as text. */
export function generateFragmentFiles(config: FragmentConfig): Record<string, string> {
  const kernelSchemas = config.schemas?.kernel ?? DEFAULT_KERNEL_SCHEMAS;
  const aspects = aspectsOf(config);
  const manifest = {
    $schema: `${kernelSchemas}/fragment.v1.schema.json`,
    id: config.id,
    version: config.version,
    ...(config.name !== undefined ? { name: config.name } : {}),
    ...(config.description !== undefined ? { description: config.description } : {}),
    ...(config.requires ? { requires: config.requires } : {}),
    engines: { platform: config.engines.platform },
    ...(config.bindings ? { bindings: config.bindings } : {}),
    aspects: Object.fromEntries(
      Object.entries(aspects).map(([aspect, value]) => [
        aspect,
        value.dir !== undefined ? { dir: value.dir } : {},
      ]),
    ),
  };
  const files: Record<string, string> = { [MANIFEST_FILE]: text(manifest) };
  for (const [name, value] of Object.entries(aspects)) {
    const aspect = name as Aspect;
    const content = aspectFile(value, kernelSchemas);
    // The server's own file is wrangler.jsonc; fragment.server.jsonc only when it has content.
    if (aspect === "server" && Object.keys(content).length === 1) continue;
    files[aspectFileOf(aspect)] = text(content);
  }
  if (config.server) files[WRANGLER_FILE] = text(wranglerFile(config, config.server));
  const catalogue = openApiCatalogue(config);
  if (catalogue) files[CATALOGUE_FILE] = `${JSON.stringify(catalogue, null, 2)}\n`;
  return files;
}

function aspectFile(config: AspectConfig, kernelSchemas: string): Record<string, unknown> {
  const points = Object.entries(config.extensionPoints ?? {});
  const extensions = config.extensions ?? [];
  return {
    $schema: `${kernelSchemas}/fragment-aspect.v1.schema.json`,
    ...(points.length > 0
      ? {
          extensionPoints: Object.fromEntries(
            points.map(([name, point]) => [
              name,
              {
                ...(point.description !== undefined ? { description: point.description } : {}),
                schema: toJsonSchema(point.schema),
              },
            ]),
          ),
        }
      : {}),
    ...(extensions.length > 0
      ? {
          extensions: extensions.map((e) => ({
            point: e.point,
            data: e.data,
            ...(e.reference ? { reference: e.reference } : {}),
          })),
        }
      : {}),
  };
}

const GENERATED_WRANGLER_KEYS = [
  "name",
  "main",
  "compatibility_date",
  "durable_objects",
  "migrations",
];

function wranglerFile(config: FragmentConfig, server: ServerConfig): Record<string, unknown> {
  for (const key of Object.keys(server.wrangler ?? {})) {
    if (GENERATED_WRANGLER_KEYS.includes(key) || key === "$schema") {
      throw new Error(`server.wrangler.${key} is generated; set it through the server config`);
    }
  }
  const main = (server.main ?? "index.ts").replace(/^\.\//, "");
  return {
    $schema: config.schemas?.wrangler ?? DEFAULT_WRANGLER_SCHEMA,
    name: workerNameOf(config.id),
    main: `${aspectDir(config, "server")}/${main}`,
    compatibility_date: server.compatibilityDate,
    ...(server.compatibilityFlags ? { compatibility_flags: server.compatibilityFlags } : {}),
    ...server.wrangler,
    ...(server.durableObjects?.length
      ? {
          durable_objects: {
            bindings: server.durableObjects.map((d) => ({ name: d.name, class_name: d.className })),
          },
        }
      : {}),
    ...(server.migrations?.length ? { migrations: server.migrations } : {}),
  };
}
