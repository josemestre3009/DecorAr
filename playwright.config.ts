import { defineConfig, devices } from "@playwright/test";

const managedUrl = "http://localhost:4173";

// Permite apuntar a un servidor ya levantado (p. ej. `npm run dev` en el 3000)
// sin que Playwright intente iniciar otro en el mismo directorio, algo que Next
// rechaza por el bloqueo de `.next`.
const externalUrl = process.env.DECOR_E2E_BASE_URL;
const testUrl = externalUrl ?? managedUrl;

export default defineConfig({
  testDir: "./e2e",
  // Los escenarios autenticados comparten una cuenta real contra Supabase. En
  // paralelo, varias validaciones de sesión simultáneas hacen que el proveedor
  // limite las peticiones y la comprobación de sesión se vuelva intermitente.
  fullyParallel: false,
  // `fullyParallel: false` solo serializa dentro de cada archivo; los archivos
  // seguirían en workers paralelos. Con una cuenta compartida, el cierre de
  // sesión de auth.spec.ts revoca la sesión de los demás archivos a la vez.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: testUrl,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
  webServer: externalUrl
    ? undefined
    : {
        command: "npm run dev -- --port 4173",
        url: managedUrl,
        reuseExistingServer: !process.env.CI,
      },
});
