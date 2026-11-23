/** The aspects the platform fixes; fragments cannot add aspects. */
export const ASPECTS = ["server", "client", "agent"] as const;
export type Aspect = (typeof ASPECTS)[number];

/** One aspect's entry in `fragment.jsonc`. */
export interface AspectEntry {
  /** The aspect's folder, when not the default (`server/`, `client/`, `agent/`). */
  readonly dir?: string;
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
  /** Shipped with the platform (a core fragment). */
  readonly core: boolean;
}
