/** Why the settings model refused a request. */
export type SettingsErrorKind = "unknown-fragment" | "unknown-setting" | "invalid-value";

/** The one error the settings model throws. */
export class SettingsError extends Error {
  override readonly name = "SettingsError";
  constructor(
    readonly kind: SettingsErrorKind,
    /** The fragment's id. */
    readonly fragment: string,
    /** The setting's key, for `unknown-setting` and `invalid-value`. */
    readonly key?: string,
    /** What is wrong with the value, for `invalid-value`. */
    readonly reason?: string,
  ) {
    super(
      kind === "unknown-fragment"
        ? `${fragment} has no settings page`
        : kind === "unknown-setting"
          ? `${fragment} declares no setting ${key}`
          : `${fragment}: ${key}: ${reason}`,
    );
  }
}
