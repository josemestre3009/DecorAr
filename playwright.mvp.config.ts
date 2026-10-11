import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

/**
 * DECOR-39: E2E móvil del MVP. Corre desde el host contra la app levantada con
 * Docker compose en modo live (ver docs/DecorAR.md, "E2E móvil"):
 *
 *   npm run test:e2e:mvp
 *
 * No levanta servidor propio: si /api/health no responde, el setup falla.
 */

// Las variables del seed (service role, usuarios A/B) viven en los .env del
// proyecto. loadEnvFile no pisa lo ya definido: .env.local manda sobre .env.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

export default defineConfig({
  testDir: "./e2e/mobile-mvp",
  // Un solo usuario A recorre el flujo en orden; B y anónimo solo leen.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.DECOR_E2E_BASE_URL ?? "http://127.0.0.1:3000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "mvp-setup",
      testMatch: /mvp\.setup\.ts$/,
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "mobile-mvp",
      dependencies: ["mvp-setup"],
      testMatch: /.*\.spec\.ts$/,
      use: { ...devices["Pixel 5"] },
    },
  ],
});
