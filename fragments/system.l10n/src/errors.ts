/** Why the l10n model refused a request. */
export type L10nErrorKind = "invalid-locale";

/** The one error the l10n model throws. */
export class L10nError extends Error {
  override readonly name = "L10nError";
  constructor(
    readonly kind: L10nErrorKind,
    /** The locale refused. */
    readonly subject: string,
  ) {
    super(`not a BCP 47 language tag: ${subject}`);
  }
}
