import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // jsdom React tests: about 120 ms each here, but a slow CI runner (statewalker-kernel#70: a
    // run four times slower throughout, build and setup included) took one to 8 s and others to
    // 2.5-5.7 s, past vitest's default 5 s. Headroom for such a runner, not for a slow test.
    testTimeout: 20_000,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
