import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mantiene en las pruebas el mismo alias "@/*" que declara tsconfig.json,
    // para poder probar código que importa a través de la composición.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    exclude: ["e2e/**", "node_modules/**", ".opencode/**", ".next/**"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
