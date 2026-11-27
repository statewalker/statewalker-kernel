import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // jsdom React tests: a few hundred ms each here, but a slow CI runner (statewalker-kernel#70:
    // every stage 12 to 30 times slower, node-only packages too) passed vitest's default 5 s.
    // Headroom for such a runner, not for a slow test.
    testTimeout: 20_000,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
