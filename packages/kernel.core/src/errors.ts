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
  | "extension-point-conflict"
  /** An upgrade to an archive of another fragment, or of a version not later than the installed one. */
  | "not-an-upgrade"
  /**
   * A reinstall over data kept from an earlier install, bringing migrations that data has
   * not had: an install runs none.
   */
  | "pending-migrations"
  /**
   * An install or an upgrade whose archive lacks migration tags the fragment's data has
   * had (kept from an earlier install, or applied by an upgrade): old code on newer data.
   */
  | "data-too-new";

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

/**
 * A rollback refused: nothing to roll back to, or the upgrade has run migrations (the
 * data may no longer suit the previous version), or the previous archive is not in the
 * store. Nothing changed: the upgraded version stays installed and active.
 */
export class FragmentRollbackError extends FragmentLifecycleError {
  readonly id: string;
  /** The migration tags the upgrade ran, when that is why the rollback was refused. */
  readonly migrations: readonly string[];
  constructor(id: string, message: string, migrations: readonly string[] = []) {
    super(message);
    this.name = "FragmentRollbackError";
    this.id = id;
    this.migrations = migrations;
  }
}

/**
 * An upgrade refused because migrations it would run delete Durable Object classes, and
 * with them their data, without `confirmDeletedClasses`. Nothing changed; `deletions` lists
 * them for the confirmation.
 */
export class FragmentDeletesClassesError extends FragmentLifecycleError {
  readonly id: string;
  readonly deletions: readonly { readonly tag: string; readonly classes: readonly string[] }[];
  constructor(
    id: string,
    deletions: readonly { readonly tag: string; readonly classes: readonly string[] }[],
  ) {
    super(
      `Upgrading "${id}" deletes the data of ${deletions.flatMap((d) => d.classes).join(", ")}; confirm it to go on`,
    );
    this.name = "FragmentDeletesClassesError";
    this.id = id;
    this.deletions = deletions;
  }
}

/**
 * A migration of an upgrade threw (`cause`). The upgrade stopped there: the new archive
 * stays installed, inactive, the tags that ran before stay recorded, and a rollback is
 * allowed only when none ran.
 */
export class FragmentMigrationError extends FragmentLifecycleError {
  readonly id: string;
  readonly tag: string;
  constructor(id: string, tag: string, cause: unknown) {
    super(`The migration "${tag}" of "${id}" failed: ${String(cause)}`);
    this.name = "FragmentMigrationError";
    this.id = id;
    this.tag = tag;
    this.cause = cause;
  }
}
