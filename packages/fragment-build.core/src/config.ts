import type { ExtensionReference } from "@statewalker/kernel.core";
import type { z } from "zod";

/** A JSON Schema (2020-12) written by hand. */
export type JsonSchema = Readonly<Record<string, unknown>> | boolean;

/** A schema in a config: a Zod schema (converted with `z.toJSONSchema`) or JSON Schema. */
export type SchemaInput = z.ZodType | JsonSchema;

/** An extension point a fragment opens in one aspect. */
export interface ExtensionPointConfig {
  readonly description?: string;
  /** What every extension's data must match. */
  readonly schema: SchemaInput;
}

/** An extension to a point of the same aspect. */
export interface ExtensionConfig {
  /** The point's id: `<fragment-id>/<name>`, or a core point's short name (`commands`). */
  readonly point: string;
  readonly data: unknown;
  readonly reference?: ExtensionReference;
}

/** What every aspect may declare. */
export interface AspectConfig {
  /** The aspect's folder, when not the default (`server/`, `client/`, `agent/`). */
  readonly dir?: string;
  /** The extension points opened in this aspect, by name. */
  readonly extensionPoints?: Readonly<Record<string, ExtensionPointConfig>>;
  /** Extensions to points of this aspect. */
  readonly extensions?: readonly ExtensionConfig[];
}

/** One Durable Object binding of the server half. */
export interface DurableObjectConfig {
  /** The binding's name in `env` (`COUNTER`). */
  readonly name: string;
  /** The exported class (`Counter`). */
  readonly className: string;
}

/** One Durable Object migration, as wrangler writes it. */
export interface MigrationConfig {
  readonly tag: string;
  readonly new_sqlite_classes?: readonly string[];
  readonly new_classes?: readonly string[];
  readonly renamed_classes?: readonly { readonly from: string; readonly to: string }[];
  readonly deleted_classes?: readonly string[];
}

/** The server half: a standard wrangler project in its folder. */
export interface ServerConfig extends AspectConfig {
  /** The Worker's entry, relative to the server folder. Default `index.ts`. */
  readonly main?: string;
  /** wrangler's `compatibility_date` (`YYYY-MM-DD`); required, so a build never depends on today. */
  readonly compatibilityDate: string;
  readonly compatibilityFlags?: readonly string[];
  readonly durableObjects?: readonly DurableObjectConfig[];
  readonly migrations?: readonly MigrationConfig[];
  /**
   * Any other standard wrangler keys (`vars`, `kv_namespaces`, ...), copied as they are.
   * `name`, `main`, `compatibility_date`, `durable_objects` and `migrations` are generated.
   */
  readonly wrangler?: Readonly<Record<string, unknown>>;
}

/** What a command does, which drives the agent's mode (harness action kinds). */
export type ActionKind = "read" | "write" | "admin";

/** Where a command is offered besides the bus; each one opt-in. */
export interface ExposuresConfig {
  readonly agent?: { readonly action: ActionKind };
  readonly http?: { readonly path: string };
  readonly mcp?: Readonly<Record<string, never>>;
}

/** An error a command declares: its HTTP-style status and the schema of its `data`. */
export interface CommandErrorConfig {
  /** The response key (`404`, `4XX`). Default `400`. */
  readonly status?: string | number;
  readonly description?: string;
  /** The schema of the error's `data`, if it carries any. */
  readonly data?: SchemaInput;
}

/** One command: an OpenAPI 3.1 operation generated from its schemas. */
export interface CommandConfig {
  readonly summary?: string;
  readonly description?: string;
  /** The input: an object schema. Absent: no input (an empty closed object). */
  readonly input?: SchemaInput;
  /** The output (the 200 response). Absent: anything. */
  readonly output?: SchemaInput;
  /** Declared errors, by code. */
  readonly errors?: Readonly<Record<string, CommandErrorConfig>>;
  readonly exposures?: ExposuresConfig;
  /** Localized title and description, by locale. */
  readonly labels?: Readonly<
    Record<string, { readonly title?: string; readonly description?: string }>
  >;
  /** The handler: a lazy reference (a client module export or a server entrypoint method). */
  readonly handler?: ExtensionReference;
}

/** Where the `$schema` of each generated file points. */
export interface SchemaLocations {
  /** The folder holding kernel.core's schemas. Default `./node_modules/@statewalker/kernel.core/schemas`. */
  readonly kernel?: string;
  /** The `$schema` of `wrangler.jsonc`. Default `./node_modules/wrangler/config-schema.json`. */
  readonly wrangler?: string;
}

/** A fragment's `fragment.config.ts`. */
export interface FragmentConfig {
  /** Reverse-domain id, never changed. */
  readonly id: string;
  readonly version: string;
  readonly name?: string;
  readonly description?: string;
  /** Required fragments: id to semver range. */
  readonly requires?: Readonly<Record<string, string>>;
  readonly engines: { readonly platform: string };
  /** Bindings the host must offer. */
  readonly bindings?: readonly string[];
  readonly server?: ServerConfig;
  readonly client?: AspectConfig;
  readonly agent?: AspectConfig;
  /**
   * Commands, by command id, contributed to `system.commands`' `commands` point (client
   * aspect: a fragment with commands has a client aspect, generated if not declared).
   */
  readonly commands?: Readonly<Record<string, CommandConfig>>;
  readonly schemas?: SchemaLocations;
}

/** Type a `fragment.config.ts`'s default export. */
export function defineFragment<const C extends FragmentConfig>(config: C): C {
  return config;
}
