import { defineConfig } from "vite";
import { resolve } from "path";
import { builtinModules } from "module";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "shadowshell-backend",
      fileName: () => "script.js",
      formats: ["es"],
    },
    outDir: "../../dist/backend",
    rollupOptions: {
      external: [/caido:.+/, ...builtinModules],
      output: {
        manualChunks: undefined,
      },
    },
  },
});
