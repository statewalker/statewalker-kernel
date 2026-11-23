import type { OutputUnit } from "@cfworker/json-schema";

/** cfworker's output units as one line, leaving out the units that only wrap others. */
export function describeErrors(errors: readonly OutputUnit[]): string {
  return errors
    .filter((e) => e.keyword !== "properties" && e.keyword !== "$ref")
    .map((e) => `${e.instanceLocation || "#"}: ${e.error}`)
    .join("; ");
}
