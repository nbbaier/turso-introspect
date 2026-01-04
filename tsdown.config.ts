import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  platform: "node",
  outDir: "dist",
  clean: true,
  banner: "#!/usr/bin/env node",
  outputOptions: {
    entryFileNames: "[name].js",
  },
});
