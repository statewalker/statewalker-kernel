/**
 * The part of the user's profile the kernel writes: plain JSON values under string keys.
 * The host supplies it (`system.profile` keeps it with the settings values, layouts and
 * route table); the kernel stays storage-free. Keys the kernel uses: `fragmentRecordKey`
 * and `appliedMigrationsKey`.
 */
export interface KernelProfile {
  get(key: string): unknown | Promise<unknown>;
  set(key: string, value: unknown): void | Promise<void>;
  delete(key: string): void | Promise<void>;
}

/** An archive of a fragment: its version and content hash (see `archiveHash`). */
export interface ArchiveRef {
  readonly version: string;
  readonly archive: string;
}

/**
 * What the profile records of an installed fragment (under `fragmentRecordKey(id)`): its
 * version, the hash of its archive, whether it is enabled and, after an upgrade, the
 * archive it replaced and the migrations that upgrade ran. Deleted on removal.
 */
export interface FragmentRecord extends ArchiveRef {
  readonly enabled: boolean;
  /** The last upgrade, until a rollback undoes it or a later upgrade replaces it. */
  readonly upgrade?: {
    /** The version and archive before the upgrade: what a rollback goes back to. */
    readonly from: ArchiveRef;
    /** The migration tags the upgrade ran; a rollback is refused once there is one. */
    readonly migrations: readonly string[];
  };
}

/** The profile key of an installed fragment's `FragmentRecord`: `fragments/<id>`. */
export function fragmentRecordKey(id: string): string {
  return `fragments/${id}`;
}

/**
 * The migrations of a fragment's data (under `appliedMigrationsKey(id)`). It describes the
 * data, so it is kept when the fragment is removed with its data kept, and deleted with
 * the data. Each migration is recorded as `started` before it runs, then moved to
 * `applied` once it has run, or to `failed` when it threw: a `started` left behind is a
 * migration whose end was never recorded (the process died, a write failed), which the
 * host reconciles by checking the data and writing this record itself.
 */
export interface MigrationState {
  /** The tags applied, in the order they ran. */
  readonly applied: readonly string[];
  /** A tag that started and whose end was not recorded: it may or may not have run. */
  readonly started?: string;
  /** A tag whose migration threw: it may have changed part of the data; it runs again. */
  readonly failed?: string;
}

/** The profile key of a fragment's `MigrationState`: `migrations/<id>`. */
export function appliedMigrationsKey(id: string): string {
  return `migrations/${id}`;
}

/** A `KernelProfile` in memory, for tests. Values are copied in and out. */
export function createMemoryProfile(): KernelProfile & { keys(): string[] } {
  const values = new Map<string, unknown>();
  return {
    get: (key) => (values.has(key) ? structuredClone(values.get(key)) : undefined),
    set: (key, value) => {
      values.set(key, structuredClone(value));
    },
    delete: (key) => {
      values.delete(key);
    },
    keys: () => [...values.keys()],
  };
}
