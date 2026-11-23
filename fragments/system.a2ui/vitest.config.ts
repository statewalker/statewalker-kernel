import { defineConfig } from "vitest/config";

// `source` first: workspace packages (kernel.core) are tested from their sources, unbuilt.
const conditions = ["source", "import", "module", "default"];

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["node_modules", "dist", "coverage"],
  },
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
});
