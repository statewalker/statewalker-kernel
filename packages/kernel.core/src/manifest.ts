/** The aspects the platform fixes; fragments cannot add aspects. */
export const ASPECTS = ["server", "client", "agent"] as const;
export type Aspect = (typeof ASPECTS)[number];

/** A lazy reference to a client module's export (`default` when `export` is absent). */
export interface ModuleReference {
  readonly module: string;
  readonly export?: string;
}

/** A lazy reference to a method of the server half's entrypoint, through a service binding. */
export interface EntrypointReference {
  readonly entrypoint: string;
  readonly method: string;
}

/** A lazy reference to a command. */
export interface CommandReference {
  readonly command: string;
}

/** A lazy reference to the contributor's code: what an extension may carry beside its data. */
export type ExtensionReference = ModuleReference | EntrypointReference | CommandReference;

/** The kinds of lazy reference, each resolved by a host-supplied resolver. */
export type ReferenceKind = "module" | "entrypoint" | "command";

/** An extension point a fragment opens in one aspect. */
export interface ExtensionPointDeclaration {
  readonly description?: string;
  /** The JSON Schema (2020-12) every extension's data must match. */
  readonly schema: Readonly<Record<string, unknown>> | boolean;
}

/** One extension declared in a fragment's aspect. */
export interface ExtensionDeclaration {
  /** The point's id: `<fragment-id>/<name>`, or a core point's short name. */
  readonly point: string;
  readonly data: unknown;
  readonly reference?: ExtensionReference;
}

/** One aspect's entry in `fragment.jsonc`. */
export interface AspectEntry {
  /** The aspect's folder, when not the default (`server/`, `client/`, `agent/`). */
  readonly dir?: string;
}

/**
 * The content of an aspect file, version 1: `fragment.client.jsonc`, `fragment.agent.jsonc`,
 * or `fragment.server.jsonc` (beside the server aspect's unchanged `wrangler.jsonc`).
 */
export interface AspectManifest {
  readonly $schema: string;
  /** The extension points the fragment opens in this aspect, by name. */
  readonly extensionPoints?: Readonly<Record<string, ExtensionPointDeclaration>>;
  /** The fragment's extensions to points of this aspect. */
  readonly extensions?: readonly ExtensionDeclaration[];
}

/** The aspect file of `aspect`: `fragment.<aspect>.jsonc`. */
export function aspectFileOf(aspect: Aspect): string {
  return `fragment.${aspect}.jsonc`;
}

/** The content of a `fragment.jsonc`, version 1. */
export interface FragmentManifest {
  readonly $schema: string;
  readonly id: string;
  readonly version: string;
  readonly name?: string;
  readonly description?: string;
  /** Required fragments: id to semver range. */
  readonly requires?: Readonly<Record<string, string>>;
  readonly engines: { readonly platform: string };
  /** Bindings the host must offer. */
  readonly bindings?: readonly string[];
  readonly aspects: Readonly<Partial<Record<Aspect, AspectEntry>>>;
}

/** An archive's root files, by name (`fragment.jsonc`, `wrangler.jsonc`, ...), as text. */
export type FragmentFiles = Readonly<Record<string, string>>;

/** A fragment the kernel installed: its manifest and its files. */
export interface InstalledFragment {
  readonly id: string;
  readonly manifest: FragmentManifest;
  readonly files: FragmentFiles;
  /**
   * The aspect files read, by aspect: one for each client and agent aspect present, and
   * for the server aspect when it has a `fragment.server.jsonc`.
   */
  readonly aspects: Readonly<Partial<Record<Aspect, AspectManifest>>>;
  /** Shipped with the platform (a core fragment). */
  readonly core: boolean;
}
