/**
 * DECOR-22: configurador de paquete contra la API real y el Supabase alojado.
 *
 * Opt-in: solo corre con DECOR_LIVE_SMOKE=1 y las variables de Supabase, porque
 * crea un usuario real (admin API, `email_confirm: true`) que se elimina al
 * final; sus paquetes se borran en cascada. El servidor debe estar en modo
 * live: Playwright levanta `npm run dev` heredando NEXT_PUBLIC_DECOR_PACKAGES_API.
 * Cada prueba graba video (evidencia de la entrega).
 *
 *   DECOR_LIVE_SMOKE=1 NEXT_PUBLIC_DECOR_PACKAGES_API=live node --env-file=.env.local node_modules/@playwright/test/cli.js test e2e/package-configurator-live.spec.ts
 *
 * El total confirmado requiere la migración de Presupuesto (DECOR-33) aplicada
 * en el alojado.
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { expect, test, type Locator, type Page } from "@playwright/test";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const enabled =
  process.env.DECOR_LIVE_SMOKE === "1" &&
  process.env.NEXT_PUBLIC_DECOR_PACKAGES_API === "live" &&
  Boolean(url && serviceRoleKey);
const disabledReason =
  "requiere DECOR_LIVE_SMOKE=1, NEXT_PUBLIC_DECOR_PACKAGES_API=live, NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY";

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const PACKAGE_URL = /\/packages\/[0-9a-f-]{36}$/;

test.use({ video: "on", viewport: { height: 780, width: 360 } });

test.describe.serial("DECOR-22 configurador contra la API real", () => {
  test.skip(!enabled, disabledReason);

  const admin = enabled ? createClient(url, serviceRoleKey, noSession) : (null as never);
  const email = `decor22-e2e-${randomUUID()}@decorar.test`;
  const password = `${randomUUID()}Aa1!`;
  let userId: string | null = null;

  test.beforeAll(async () => {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    userId = created.data.user.id;
  });

  test.afterAll(async () => {
    // packages.user_id → auth.users ON DELETE CASCADE: se van paquetes, grupos e ítems.
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  async function signIn(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/packages$/);
  }

  async function createPackage(page: Page, spaceLabel: string, capacity: string) {
    await page.getByLabel(spaceLabel).check();
    await page.getByLabel("Capacidad del espacio (m²)").fill(capacity);
    await page.getByRole("button", { name: "Crear paquete" }).click();
    await expect(page).toHaveURL(PACKAGE_URL);
  }

  const contents = (page: Page) => page.getByRole("region", { name: "Contenido del paquete" });
  const facts = (page: Page) => page.getByRole("region", { name: "Tu espacio" }).getByRole("definition");
  const leafRow = (scope: Locator, name: string) =>
    scope.getByRole("listitem").filter({ has: scope.page().getByText(name, { exact: true }) }).last();

  async function addFromCatalog(page: Page, moduleName: string) {
    await page.getByRole("button", { name: `Agregar ${moduleName}` }).click();
  }

  test("Builder: con 30 m² una pista entra y la segunda se rechaza sin mutar la interfaz", async ({ page }) => {
    await signIn(page);
    await createPackage(page, "Casa", "30");

    await expect(facts(page)).toHaveText(["Casa", "30 m²", "0 m²", "30 m²"]);

    await addFromCatalog(page, "Pista de baile");
    await expect(leafRow(contents(page), "Pista de baile")).toContainText("×1");
    await expect(facts(page)).toHaveText(["Casa", "30 m²", "16 m²", "14 m²"]);

    await addFromCatalog(page, "Pista de baile");
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "excede la capacidad del espacio (32/30 m²)",
    );
    await expect(leafRow(contents(page), "Pista de baile")).toContainText("×1");
    await expect(facts(page)).toHaveText(["Casa", "30 m²", "16 m²", "14 m²"]);
  });

  test("otra capacidad cambia el resultado y el Composite se despliega con arco + mesa", async ({ page }) => {
    await signIn(page);
    await createPackage(page, "Salón social", "50");

    await addFromCatalog(page, "Pista de baile");
    await expect(leafRow(contents(page), "Pista de baile")).toContainText("×1");
    await addFromCatalog(page, "Pista de baile");
    await expect(leafRow(contents(page), "Pista de baile")).toContainText("×2");
    await expect(facts(page)).toHaveText(["Salón social", "50 m²", "32 m²", "18 m²"]);

    await page.getByRole("button", { name: "Agregar Zona de bienvenida" }).click();
    const zona = contents(page).getByRole("button", { name: /Zona de bienvenida/ });
    await expect(zona).toHaveAttribute("aria-expanded", "false");
    await expect(facts(page)).toHaveText(["Salón social", "50 m²", "38 m²", "12 m²"]);

    await zona.click();
    await expect(zona).toHaveAttribute("aria-expanded", "true");
    const children = page.locator(`#${await zona.getAttribute("aria-controls")}`);
    await expect(children.getByText("Arco floral", { exact: true })).toBeVisible();
    await expect(children.getByText("Mesa redonda", { exact: true })).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("el total confirmado viene de Presupuesto", async ({ page }) => {
    await signIn(page);
    await createPackage(page, "Casa", "30");

    const budget = page.getByRole("region", { name: "Presupuesto" });
    await expect(budget).toContainText("Presupuesto aún no calculado");

    await addFromCatalog(page, "Arco floral");
    await expect(leafRow(contents(page), "Arco floral")).toContainText("×1");
    await expect(budget).toContainText("Total confirmado");
    await expect(budget.getByRole("status")).toContainText("200.000");
  });

  test("Prototype: el clon es independiente del original", async ({ page }) => {
    await signIn(page);
    await createPackage(page, "Salón social", "50");
    const originalUrl = page.url();

    await addFromCatalog(page, "Pista de baile");
    await expect(leafRow(contents(page), "Pista de baile")).toContainText("×1");
    await addFromCatalog(page, "Pista de baile");
    await expect(leafRow(contents(page), "Pista de baile")).toContainText("×2");

    await page.getByRole("button", { name: "Duplicar paquete" }).click();
    await expect(page).not.toHaveURL(originalUrl);
    await expect(page).toHaveURL(PACKAGE_URL);
    await expect(leafRow(contents(page), "Pista de baile")).toContainText("×2");

    await contents(page).getByRole("button", { name: "Quitar una unidad de Pista de baile" }).click();
    await expect(leafRow(contents(page), "Pista de baile")).toContainText("×1");
    await expect(facts(page)).toHaveText(["Salón social", "50 m²", "16 m²", "34 m²"]);

    await page.goto(originalUrl);
    await expect(leafRow(contents(page), "Pista de baile")).toContainText("×2");
    await expect(facts(page)).toHaveText(["Salón social", "50 m²", "32 m²", "18 m²"]);
  });

  test("un paquete ajeno responde 404", async ({ page }) => {
    await signIn(page);

    const response = await page.goto(`/packages/${randomUUID()}`);
    expect(response?.status()).toBe(404);
  });
});
