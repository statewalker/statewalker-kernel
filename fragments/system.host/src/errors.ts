import type { HostServiceKind } from "./archive.js";

/**
 * Why a host service call was refused: no fragment contributes the service and the host has
 * none (`unavailable`), or the contributed service lacks the method called (`invalid-service`).
 */
export type HostServiceErrorKind = "unavailable" | "invalid-service";

/** The one error system.host raises itself; a service's own failures pass through unchanged. */
export class HostServiceError extends Error {
  override readonly name = "HostServiceError";
  constructor(
    readonly kind: HostServiceErrorKind,
    readonly service: HostServiceKind,
    /** The contributing fragment, for `invalid-service`. */
    readonly fragment?: string,
  ) {
    super(
      kind === "unavailable"
        ? `no ${service} service: the host has none and no fragment contributes one`
        : `the ${service} service of ${fragment} lacks the method called`,
    );
  }
}
