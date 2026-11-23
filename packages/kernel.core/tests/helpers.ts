import { type KeyedSlotDeclaration, Slots } from "@statewalker/shared-slots";
import { createKernel, type KernelOptions } from "../src/index.js";

export const SCHEMA = "https://example.org/schemas/fragment.v1.schema.json";

/** The text of a `fragment.jsonc` for `manifest`, with a comment, as authors write it. */
export function fragmentJsonc(manifest: Record<string, unknown>): string {
  return `// generated for a test\n${JSON.stringify({ $schema: SCHEMA, ...manifest }, null, 2)}\n`;
}

/** An archive's root files: a `fragment.jsonc` plus any other file. */
export function archive(
  manifest: Record<string, unknown>,
  files: Record<string, string> = {},
): Record<string, string> {
  return { "fragment.jsonc": fragmentJsonc(manifest), ...files };
}

/** The ids in a keyed slot, in registration order. */
export function ids(map: ReadonlyMap<string, unknown>): string[] {
  return [...map.keys()];
}

export function newKernel(options: Partial<KernelOptions> = {}) {
  const slots = options.slots ?? new Slots();
  const kernel = createKernel({
    platform: { version: "1.0.0", bindings: [] },
    ...options,
    slots,
  });
  return { kernel, slots };
}

/**
 * Record every membership change of a keyed slot as `+id` / `-id`, in the order the
 * slot reported them.
 */
export function membershipLog(
  slots: Slots,
  decl: KeyedSlotDeclaration<unknown>,
): { readonly events: string[]; stop(): void } {
  const events: string[] = [];
  let previous = new Set<string>();
  const stop = slots.observe(decl, (entries) => {
    const current = new Set(entries.keys());
    for (const id of previous) if (!current.has(id)) events.push(`-${id}`);
    for (const id of current) if (!previous.has(id)) events.push(`+${id}`);
    previous = current;
  });
  events.length = 0; // the initial snapshot is not a change
  return { events, stop };
}

/** A manifest with defaults for the fields a test does not care about. */
export function fragment(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    version: "1.0.0",
    engines: { platform: "^1.0.0" },
    aspects: { client: {} },
    ...extra,
  };
}
