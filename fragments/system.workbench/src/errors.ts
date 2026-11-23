/** Why the workbench refused a request. */
export type WorkbenchErrorKind = "unknown-view" | "no-component" | "unknown-surface";

/** The one error the workbench model throws. */
export class WorkbenchError extends Error {
  override readonly name = "WorkbenchError";
  constructor(
    readonly kind: WorkbenchErrorKind,
    /** The view's identity, `<fragment-id>/<view-id>`, or the surface's id. */
    readonly view: string,
  ) {
    super(
      kind === "unknown-view"
        ? `no view ${view} is contributed`
        : kind === "unknown-surface"
          ? `no surface ${view} can be docked (no surface source holds it)`
          : `the view ${view} has no component (its extension carries no reference)`,
    );
  }
}
