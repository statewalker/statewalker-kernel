/** Why the workbench refused a request. */
export type WorkbenchErrorKind =
  | "unknown-view"
  | "no-component"
  | "no-commands"
  | "unknown-dialog"
  | "unknown-notification";

const MESSAGES: Record<WorkbenchErrorKind, (subject: string) => string> = {
  "unknown-view": (view) => `no view ${view} is contributed`,
  "no-component": (view) =>
    `the view ${view} has no component (its extension carries no reference)`,
  "no-commands": (command) => `cannot run ${command}: the workbench has no command bus`,
  "unknown-dialog": (dialog) => `no dialog ${dialog} is declared`,
  "unknown-notification": (notification) => `no notification ${notification} is declared`,
};

/** The one error the workbench model throws. */
export class WorkbenchError extends Error {
  override readonly name = "WorkbenchError";
  constructor(
    readonly kind: WorkbenchErrorKind,
    /** What was asked for: a view's identity (`<fragment-id>/<view-id>`), a command's, ... */
    readonly view: string,
  ) {
    super(MESSAGES[kind](view));
  }
}
