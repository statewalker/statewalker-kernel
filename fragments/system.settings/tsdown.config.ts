import { defineConfig } from "tsdown";

export default defineConfig({
  // The headless half (React-free) and the client half (React), each one module.
  entry: { index: "src/index.ts", "client/index": "client/index.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  // `.js` / `.d.ts` to match the `exports` of package.json.
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
});
