import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const BASE_EXCLUDE = ["e2e/**", "node_modules/**", ".opencode/**", ".next/**"];

// Suites que arrancan PostgreSQL embebido (PGlite) y aplican todas las
// migraciones en beforeAll. Corren en su propio proyecto, en serie y al final,
// con timeouts largos solo para ellas; el resto conserva los valores por
// defecto. Si añades otra suite con PGlite, agrégala aquí.
const PGLITE_TESTS = [
  "src/modules/packages/decor-24-acceptance.test.ts",
  "src/modules/packages/decor-25-acceptance.test.ts",
  "src/modules/packages/decor-27-acceptance.test.ts",
  "supabase/migrations/add-package-items-batch.test.ts",
  "supabase/migrations/authorize-packages-and-private-channels.test.ts",
  "supabase/migrations/create-idempotent-budget-consumer.test.ts",
  "supabase/migrations/create-package-groups.test.ts",
  "supabase/migrations/decor-44-event-templates.test.ts",
  "supabase/migrations/edit-decorative-groups.test.ts",
];

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
    exclude: BASE_EXCLUDE,
    setupFiles: ["./vitest.setup.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          exclude: [...BASE_EXCLUDE, ...PGLITE_TESTS],
          testTimeout: 15_000,
        },
      },
      {
        extends: true,
        test: {
          name: "pglite",
          include: PGLITE_TESTS,
          hookTimeout: 60_000,
          testTimeout: 20_000,
          maxWorkers: 1,
        },
      },
    ],
  },
});
