/** Why the appearance model refused a request. */
export type AppearanceErrorKind = "invalid-brand" | "unknown-brand" | "unknown-theme";

/** The one error the appearance model throws. */
export class AppearanceError extends Error {
  override readonly name = "AppearanceError";
  constructor(
    readonly kind: AppearanceErrorKind,
    /** The brand's or theme's id, or what is wrong with the brand. */
    readonly subject: string,
  ) {
    super(
      kind === "invalid-brand"
        ? `the application's brand is not valid: ${subject}`
        : kind === "unknown-brand"
          ? `no brand ${subject} is contributed`
          : `no theme ${subject} is contributed`,
    );
  }
}
