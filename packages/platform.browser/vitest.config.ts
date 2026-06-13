import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist", "coverage"],
  },
  resolve: {
    conditions: ["source", "import", "module", "default"],
  },
});
