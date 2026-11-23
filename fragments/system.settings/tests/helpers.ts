// Seam 1 helpers: the real kernel with system.profile and system.settings as core fragments, and
// test fragments contributing settings pages.
import { createKernel, extensionRefusalsSlot, type Kernel } from "@statewalker/kernel.core";
import { createSystemL10n, SYSTEM_L10N_ID, systemL10nArchive } from "@statewalker/system.l10n";
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
  return fragmentWith(
    id,
    pages.map((data) => ({ point: "settings", data })),
  );
}

/** A client-only fragment with these extensions. */
export function fragmentWith(
  id: string,
  extensions: readonly { point: string; data: unknown }[],
): Record<string, string> {
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
      extensions,
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
  {
    storage = createMemoryStorage(),
    locale,
  }: { storage?: StorageLike /** With system.l10n, in this language. */; locale?: string } = {},
) {
  const profile = createSystemProfile({ storage, prefix: "app:" });
  const l10n = locale === undefined ? undefined : createSystemL10n({ locale });
  const system = createSystemSettings({
    profile: profile.store,
    ...(l10n ? { l10n: l10n.l10n } : {}),
  });
  const kernel: Kernel = createKernel({
    platform: { version: "1.0.0", bindings: [] },
    core: [systemProfileArchive, systemSettingsArchive, ...(l10n ? [systemL10nArchive] : [])],
    profile: profile.store,
    removeData: (f) => system.removeData(f.id),
    activators: {
      client: (f, context) => {
        if (f.id === SYSTEM_PROFILE_ID) return profile.activate(context);
        if (f.id === SYSTEM_SETTINGS_ID) return system.activate(context);
        if (f.id === SYSTEM_L10N_ID) return l10n?.activate(context);
        return undefined;
      },
    },
  });
  await kernel.start();
  for (const f of await kernel.install(archives)) await kernel.enable(f.id);
  await kernel.activate("client");
  const refused = () => [...kernel.slots.getSnapshot(extensionRefusalsSlot("client")).values()];
  return {
    kernel,
    settings: system.settings,
    store: profile.store,
    storage,
    refused,
    l10n: l10n?.l10n,
  };
}
