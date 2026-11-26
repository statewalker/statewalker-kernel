// The fragment's own files. `fragment.jsonc` at the package root is the same document as written on
// disk (a test keeps them equal), so the folder is the fragment and the host gets its archive
// without reading files.
import type { FragmentFiles } from "@statewalker/kernel.core";

/** The fragment's id (a core fragment: the reserved `system.` prefix). */
export const SYSTEM_FRAGMENTS_ID = "system.fragments";

const KERNEL_SCHEMAS = "./node_modules/@statewalker/kernel.core/schemas";

/** The archive the kernel installs as a core fragment. */
export const systemFragmentsArchive: FragmentFiles = {
  "fragment.jsonc": JSON.stringify({
    $schema: `${KERNEL_SCHEMAS}/fragment.v1.schema.json`,
    id: SYSTEM_FRAGMENTS_ID,
    version: "0.1.0",
    name: "Fragments",
    description:
      "The fragment manager: install with the user's consent, enable, disable, retry and remove.",
    engines: { platform: "*" },
    aspects: {},
  }),
};
