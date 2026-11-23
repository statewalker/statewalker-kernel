// Seam 1 helpers: the real kernel with system.profile and system.settings as core fragments, and
// test fragments contributing settings pages.
import { createKernel, extensionRefusalsSlot, type Kernel } from "@statewalker/kernel.core";
import {
  createMemoryStorage,
  createSystemProfile,
  type StorageLike,
  SYSTEM_PROFILE_ID,
  systemProfileArchive,
} from "@statewalker/system.profile";
import { createSystemSettings, SYSTEM_SETTINGS_ID, systemSettingsArchive } from "../src/index.js";

const SCHEMA = "https://example.org/schemas/fragment.v1.schema.json";
const ASPECT_SCHEMA = "https://example.org/schemas/fragment-aspect.v1.schema.json";

/** A client-only fragment contributing these `settings` pages (and nothing else). */
export function fragment(id: string, ...pages: unknown[]): Record<string, string> {
  return {
    "fragment.jsonc": JSON.stringify({
      $schema: SCHEMA,
      id,
      version: "1.0.0",
      engines: { platform: "^1.0.0" },
      aspects: { client: {} },
    }),
    "fragment.client.jsonc": JSON.stringify({
      $schema: ASPECT_SCHEMA,
      extensions: pages.map((data) => ({ point: "settings", data })),
    }),
  };
}

/** The settings page of the tests' notes fragment. */
export const notesPage = {
  title: "Notes",
  schema: {
    type: "object",
    properties: {
      sort: {
        type: "string",
        title: "Sort notes by",
        enum: ["added", "alphabetical"],
        default: "added",
      },
      copyButtons: { type: "boolean", title: "Copy buttons", default: true },
      max: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      greeting: { type: "string", maxLength: 10 },
    },
  },
};

/**
 * The kernel with both core fragments over `storage` (a new memory storage by default: pass the
 * same one again for a reload), these fragments installed, enabled and active.
 */
export async function platform(
  archives: Record<string, string>[],
  { storage = createMemoryStorage() }: { storage?: StorageLike } = {},
) {
  const profile = createSystemProfile({ storage, prefix: "app:" });
  const system = createSystemSettings({ profile: profile.store });
  const kernel: Kernel = createKernel({
    platform: { version: "1.0.0", bindings: [] },
    core: [systemProfileArchive, systemSettingsArchive],
    profile: profile.store,
    removeData: (f) => system.removeData(f.id),
    activators: {
      client: (f, context) => {
        if (f.id === SYSTEM_PROFILE_ID) return profile.activate(context);
        if (f.id === SYSTEM_SETTINGS_ID) return system.activate(context);
        return undefined;
      },
    },
  });
  await kernel.start();
  for (const f of await kernel.install(archives)) await kernel.enable(f.id);
  await kernel.activate("client");
  const refused = () => [...kernel.slots.getSnapshot(extensionRefusalsSlot("client")).values()];
  return { kernel, settings: system.settings, store: profile.store, storage, refused };
}
