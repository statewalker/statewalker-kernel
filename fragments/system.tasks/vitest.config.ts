import { defineConfig } from "vitest/config";

// `source` first: workspace packages (kernel.core) are tested from their sources, unbuilt.
const conditions = ["source", "import", "module", "default"];

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    exclude: ["node_modules", "dist", "coverage"],
    // Every test twice: the queue in this process, and behind the store the client half reaches
    // the fragment's DO through (every operation and answer through JSON).
    projects: [
      {
        extends: true,
        test: { name: "local", include: ["tests/**/*.test.ts"] },
      },
      {
        extends: true,
        test: { name: "remote", include: ["tests/**/*.test.ts"], env: { TASKS_STORE: "remote" } },
      },
    ],
  },
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: conditions } },
});
