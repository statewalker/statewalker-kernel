/** Why the kernel refused to install a fragment. */
export type RefusalCode =
  /** `fragment.jsonc` is missing, does not parse, or does not match its schema. */
  | "invalid-manifest"
  /** The id is neither reverse-domain nor `system.*`. */
  | "invalid-id"
  /** A `system.*` id from a fragment not shipped with the platform. */
  | "reserved-id"
  /** The server half's Worker name is not the one derived from the id. */
  | "worker-name"
  /** `engines.platform` does not include this platform's version. */
  | "incompatible-platform"
  /** A required binding this host does not offer. */
  | "missing-binding"
  /** A required fragment is absent, or present in a version outside the range. */
  | "unmet-requirement"
  /** A fragment of this id is already installed (one version per host). */
  | "already-installed"
  /** A core fragment opens a short extension point another core fragment opens too. */
  | "extension-point-conflict";

export interface Refusal {
  /** The fragment refused (as far as it could be read). */
  readonly id?: string;
  readonly code: RefusalCode;
  readonly message: string;
}

/** An install refused as a whole: nothing was installed. */
export class FragmentInstallError extends Error {
  readonly refusals: readonly Refusal[];
  constructor(refusals: readonly Refusal[]) {
    super(`Install refused: ${refusals.map((r) => r.message).join("; ")}`);
    this.name = "FragmentInstallError";
    this.refusals = refusals;
  }
}

/** A lifecycle operation that cannot be applied as asked; nothing changed. */
export class FragmentLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FragmentLifecycleError";
  }
}

/**
 * A disable or a removal refused because resolved fragments require the fragment: nothing
 * changed. `dependents` lists them, requirements first; confirm the cascade to go on.
 */
export class FragmentCascadeError extends FragmentLifecycleError {
  readonly id: string;
  readonly dependents: readonly string[];
  constructor(id: string, dependents: readonly string[], action = "disable") {
    super(
      `"${id}" is required by ${dependents.map((d) => `"${d}"`).join(", ")}; confirm the cascade to ${action} it`,
    );
    this.name = "FragmentCascadeError";
    this.id = id;
    this.dependents = dependents;
  }
}

/**
 * An extension's reference cannot be used: its contributor is no longer resolved, the
 * extension was withdrawn or refused, the owner's aspect was deactivated, or the host has
 * no resolver for the reference's kind. Raised instead of waiting, also for a resolution or
 * a call that was pending when the extension went.
 */
export class ExtensionUnavailable extends Error {
  /** The extension's id. */
  readonly extension: string;
  readonly contributor: string;
  constructor(extension: string, contributor: string, reason: string) {
    super(`Extension "${extension}" of "${contributor}" is unavailable: ${reason}`);
    this.name = "ExtensionUnavailable";
    this.extension = extension;
    this.contributor = contributor;
  }
}
