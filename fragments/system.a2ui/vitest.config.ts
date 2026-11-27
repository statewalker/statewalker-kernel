import { defineConfig } from "vitest/config";

// `source` first: workspace packages (kernel.core) are tested from their sources, unbuilt.
const conditions = ["source", "import", "module", "default"];

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules", "dist", "coverage"],
    // React tests: under a second each here, but a slow CI runner (statewalker-kernel#70: every
    // stage 12 to 30 times slower) passed vitest's default 5 s. Headroom, not for a slow test.
    testTimeout: 20_000,
  },
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
});
