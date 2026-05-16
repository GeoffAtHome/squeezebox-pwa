import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@components": fileURLToPath(new URL("./src/components", import.meta.url)),
      "@services": fileURLToPath(new URL("./src/services", import.meta.url)),
      "@utils": fileURLToPath(new URL("./src/utils", import.meta.url)),
    },
  },

  test: {
    globals: true,
    environment: "jsdom",

    // Ensure the mock loads BEFORE any component import
    setupFiles: ["./vitest.setup.ts"],

    // Prevent Vite from preloading Material Web Components
    deps: {
      inline: [/^@material\/web/],
    },

    include: ["src/**/*.test.ts", "bridge/**/*.test.ts"],
    environmentMatchGlobs: [["bridge/**/*.test.ts", "node"]],
  },
});
