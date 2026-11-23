import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The browser tests start a server and Chromium once per file.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
