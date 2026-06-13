import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // jsdom is required because workspace-bridge.manager.test.ts stubs
    // `window.showDirectoryPicker` (the FS-Access API entry point) and
    // its setup spreads the existing `window` shape into the stub.
    environment: "jsdom",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
