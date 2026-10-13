import { readFileSync } from "node:fs";

import { expect, type Locator, type Page } from "@playwright/test";

import type { SeedResult } from "../../scripts/seed-e2e";

/** Archivos que deja mvp.setup.ts (ignorados por git: contienen sesiones). */
export const AUTH_DIR = "e2e/.auth";
export const STORAGE_A = `${AUTH_DIR}/user-a.json`;
export const STORAGE_B = `${AUTH_DIR}/user-b.json`;
export const SEED_FILE = `${AUTH_DIR}/seed.json`;

export const PACKAGE_URL = /\/packages\/[0-9a-f-]{36}$/;
export const BUDGET_URL = /\/api\/packages\/[0-9a-f-]{36}\/budget$/;

export const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

export function readSeed(): SeedResult {
  return JSON.parse(readFileSync(SEED_FILE, "utf8")) as SeedResult;
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/packages$/);
}

/** Desde /packages: define el espacio con capacidad manual y llega al configurador. */
export async function createPackage(page: Page, spaceLabel: string, capacity: string) {
  await page.goto("/packages");
  // El historial de DECOR-41 también nombra "Casa" en sus enlaces: se busca en el formulario.
  const form = page.getByRole("form", { name: "Crear paquete" });
  await form.getByRole("radio", { name: spaceLabel }).check();
  await form.getByLabel("Capacidad del espacio (m²)").fill(capacity);
  await form.getByRole("button", { name: "Crear paquete" }).click();
  await expect(page).toHaveURL(PACKAGE_URL);
}

// Next agrega su propio anunciador de rutas con role="alert": se busca en <main>.
export const appAlert = (page: Page) => page.getByRole("main").getByRole("alert");
export const contents = (page: Page) => page.getByRole("region", { name: "Contenido del paquete" });
export const facts = (page: Page) => page.getByRole("region", { name: "Tu espacio" }).getByRole("definition");
export const budget = (page: Page) => page.getByRole("region", { name: "Presupuesto" });
export const leafRow = (scope: Locator, name: string) =>
  scope.getByRole("listitem").filter({ has: scope.page().getByText(name, { exact: true }) }).last();

export async function addFromCatalog(page: Page, moduleName: string) {
  await page.getByRole("button", { name: `Agregar ${moduleName}` }).click();
}

export async function hasNoHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

/** "$ 1.050.000" → 1050000, para comparar la UI con GET /budget. */
export function parseCop(text: string): number {
  const digits = text.replace(/[^\d]/g, "");
  return Number(digits);
}
