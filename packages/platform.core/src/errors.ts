/**
 * Canonical signal that the user dismissed an interactive prompt (folder
 * picker, dialog, file picker, etc.). Throwing this class — instead of a
 * raw `DOMException` with `name === "AbortError"` or an ad-hoc string — lets
 * every consumer distinguish cancellation from real failure with a single
 * `instanceof` check.
 */
export class UserCancelledError extends Error {
  readonly name = "UserCancelledError";

  constructor(message = "User cancelled the operation") {
    super(message);
  }
}

/** Returns `true` if `err` is an instance of {@link UserCancelledError}. */
export function isUserCancelled(err: unknown): boolean {
  return err instanceof UserCancelledError;
}
