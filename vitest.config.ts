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
    // Las suites PGlite arrancan PostgreSQL embebido y aplican todas las
    // migraciones en beforeAll; en paralelo con el resto superan los 10 s/5 s
    // por defecto aunque cada una sola tarde ~2-3 s.
    hookTimeout: 60_000,
    testTimeout: 20_000,
    setupFiles: ["./vitest.setup.ts"],
  },
});
