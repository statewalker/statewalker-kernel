// The fragment's own files. `fragment.jsonc` and `fragment.client.jsonc` at the package root are
// the same documents as written on disk (a test keeps them equal), so the folder is the fragment
// and the host gets its archive without reading files.
import type { FragmentFiles } from "@statewalker/kernel.core";

/** The fragment's id (a core fragment: the reserved `system.` prefix). */
export const SYSTEM_PROFILE_ID = "system.profile";

const KERNEL_SCHEMAS = "./node_modules/@statewalker/kernel.core/schemas";

export const fragmentManifest = {
  $schema: `${KERNEL_SCHEMAS}/fragment.v1.schema.json`,
  id: SYSTEM_PROFILE_ID,
  version: "0.1.0",
  name: "Profile",
  description:
    "The user's profile on this device: settings values, layouts and the kernel's records, kept locally.",
  engines: { platform: "*" },
  aspects: { client: {} },
};

/** No points yet: `secrets` and the vault come with statewalker-root#264 and #265. */
export const clientAspect = {
  $schema: `${KERNEL_SCHEMAS}/fragment-aspect.v1.schema.json`,
};

/** The fragment's archive, as the kernel takes it (`createKernel({ core: [...] })`). */
export const systemProfileArchive: FragmentFiles = Object.freeze({
  "fragment.jsonc": `${JSON.stringify(fragmentManifest, null, 2)}\n`,
  "fragment.client.jsonc": `${JSON.stringify(clientAspect, null, 2)}\n`,
});
