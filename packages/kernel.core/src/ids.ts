/** The id prefix reserved for the core fragments shipped with the platform. */
export const SYSTEM_PREFIX = "system.";

const SEGMENT = "[a-z](?:[a-z0-9-]*[a-z0-9])?";
const REVERSE_DOMAIN = new RegExp(`^${SEGMENT}(?:\\.${SEGMENT})+$`);

/** Cloudflare's limit on a Worker name. */
export const MAX_WORKER_NAME_LENGTH = 63;

/**
 * Whether `id` is a reverse-domain fragment id: two or more dot-separated segments of
 * lowercase letters, digits and inner hyphens, each starting with a letter
 * (`org.statewalker.fragment-notes`). `system.*` ids have the same form.
 */
export function isFragmentId(id: string): boolean {
  return REVERSE_DOMAIN.test(id);
}

export function isSystemId(id: string): boolean {
  return id.startsWith(SYSTEM_PREFIX);
}

/**
 * The Worker name of a fragment's server half: its id with dots turned into hyphens
 * (`org.statewalker.fragment-notes` → `org-statewalker-fragment-notes`). The installer
 * refuses a `wrangler.jsonc` with another `name`.
 */
export function workerNameOf(id: string): string {
  return id.replaceAll(".", "-");
}
