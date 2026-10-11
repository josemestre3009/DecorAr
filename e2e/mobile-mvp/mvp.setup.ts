/**
 * DECOR-39: prepara la corrida.
 * 1. Espera /api/health de la app en Docker (y que sea DecorAR, no otro servidor
 *    escuchando en el mismo puerto).
 * 2. Ejecuta el seed idempotente (usuarios A/B, paquetes previos, catálogo).
 * 3. Inicia sesión por la interfaz con A y con B y guarda su storageState.
 * 4. Comprueba que la imagen se construyó en modo live.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { expect, test as setup } from "@playwright/test";

import { readSeedConfig, seedE2E } from "../../scripts/seed-e2e";
import { AUTH_DIR, PACKAGE_URL, SEED_FILE, STORAGE_A, STORAGE_B, signIn } from "./helpers";

const config = () => readSeedConfig(process.env);

setup("la app responde /api/health", async ({ request }) => {
  await expect
    .poll(
      async () => {
        try {
          const response = await request.get("/api/health");
          return response.ok() ? await response.json() : response.status();
        } catch {
          return "sin respuesta";
        }
      },
      {
        intervals: [1_000, 2_000, 5_000],
        message: "Levanta la app con `docker compose up --build -d` (ver docs/DecorAR.md, E2E móvil)",
        timeout: 60_000,
      },
    )
    .toEqual({ status: "ok" });
});

setup("seed idempotente y sesiones de A y B", async ({ browser }) => {
  mkdirSync(AUTH_DIR, { recursive: true });
  const seed = await seedE2E(config());
  writeFileSync(SEED_FILE, JSON.stringify(seed, null, 2));

  for (const [user, file] of [
    [config().userA, STORAGE_A],
    [config().userB, STORAGE_B],
  ] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, user.email, user.password);
    await context.storageState({ path: file });
    await context.close();
  }
});

setup("la imagen corre en modo live", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STORAGE_A });
  const page = await context.newPage();

  const created = await page.request.post("/api/packages", { data: { capacityM2: 30, spaceType: "casa" } });
  expect(created.status()).toBe(201);
  const { id } = (await created.json()) as { id: string };

  await page.goto(`/packages/${id}`);
  await expect(page).toHaveURL(PACKAGE_URL);
  await expect(
    page.getByRole("region", { name: "Tu espacio" }),
    "La app está en modo simulado: reconstruye con NEXT_PUBLIC_DECOR_PACKAGES_API=live",
  ).toBeVisible();

  await context.close();
});
