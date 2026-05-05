import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  root: "src",
  envDir: "..",
  resolve: {
    alias: {
      "@components": fileURLToPath(
        new URL("./src/components", import.meta.url),
      ),
      "@services": fileURLToPath(new URL("./src/services", import.meta.url)),
      "@utils": fileURLToPath(new URL("./src/utils", import.meta.url)),
    },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL("./src/index.html", import.meta.url)),
        "service-worker": fileURLToPath(
          new URL("./src/service-worker.ts", import.meta.url),
        ),
      },
      output: {
        // Keep service-worker.js at the dist root; all other entries use hashed names
        entryFileNames: (chunk) =>
          chunk.name === "service-worker"
            ? "[name].js"
            : "assets/[name]-[hash].js",
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
