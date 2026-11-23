import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/fragment.ts", "src/index.ts"],
  unbundle: true,
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  // `.js` / `.d.ts` to match the `exports` of package.json.
  outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  external: [/\.css$/],
  copy: [
    { from: "src/**/*.css", to: "dist", flatten: false },
    { from: "src/**/*.d.css.ts", to: "dist", flatten: false },
  ],
});
