/**
 * DECOR-22 / DECOR-44: configurador de evento contra la API real y el Supabase
 * alojado. DECOR-44: el evento se crea solo con su nombre y el exceso de área es
 * un diagnóstico informativo que no bloquea la configuración.
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
  let otherUserId: string | null = null;

  test.beforeAll(async () => {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    userId = created.data.user.id;

    const other = await admin.auth.admin.createUser({
      email: `decor22-e2e-otro-${randomUUID()}@decorar.test`,
      email_confirm: true,
      password: `${randomUUID()}Aa1!`,
    });
    if (other.error) throw other.error;
    otherUserId = other.data.user.id;
  });

  test.afterAll(async () => {
    // packages.user_id → auth.users ON DELETE CASCADE: se van paquetes, grupos e ítems.
    if (userId) await admin.auth.admin.deleteUser(userId);
    if (otherUserId) await admin.auth.admin.deleteUser(otherUserId);
  });

  async function signIn(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/packages$/);
  }

  /**
   * Crea un evento (DECOR-44): solo el nombre es obligatorio. El tipo de espacio
   * y el área se completan en los detalles opcionales del formulario para que el
   * diagnóstico espacial tenga datos.
   */
  async function createEvent(page: Page, name: string, spaceLabel?: string, capacity?: string) {
    if (spaceLabel !== undefined || capacity !== undefined) {
      await page.getByText("Agregar detalles (opcional)", { exact: true }).click();
    }
    if (spaceLabel !== undefined) {
      await page.getByLabel("Tipo de espacio").selectOption({ label: spaceLabel });
    }
    if (capacity !== undefined) {
      await page.getByLabel("Área disponible (m²)").fill(capacity);
    }
    await page.getByRole("button", { name: "Crear evento" }).click();
    await expect(page).toHaveURL(PACKAGE_URL);
  }

  const eventSummary = (page: Page) =>
    page.getByRole("region", { name: "Datos del evento", exact: true });
  const contents = (page: Page) => page.getByRole("region", { name: "Contenido del evento", exact: true });
  /** Diagnóstico espacial derivado (DECOR-44): informativo, nunca bloqueante. */
  const spatial = (page: Page) => eventSummary(page).getByRole("status");
  /** Valor de un dato del evento (cliente, tipo de espacio, área...). */
  const fact = (region: Locator, label: string) => region.locator(`dt:text-is("${label}") + dd`);
  const leafRow = (scope: Locator, name: string) =>
    scope.getByRole("listitem").filter({ has: scope.page().getByText(name, { exact: true }) }).last();

  async function addFromCatalog(page: Page, moduleName: string) {
    await page.getByRole("button", { name: `Agregar ${moduleName}` }).click();
  }

  test("Builder: el exceso de área no bloquea, la segunda pista se guarda y el diagnóstico avisa", async ({
    page,
  }) => {
    await signIn(page);
    await createEvent(page, "Boda Builder", "Casa", "30");

    await expect(fact(eventSummary(page), "Tipo de espacio")).toHaveText("Casa");
    await expect(fact(eventSummary(page), "Área disponible")).toHaveText("30 m²");

    await addFromCatalog(page, "Pista de baile");
    await expect(leafRow(contents(page), "Pista de baile")).toContainText("×1");
    // 16 m² de 30 m²: compatible, con las medidas visibles.
    await expect(spatial(page)).toContainText("Compatibilidad espacial: compatible");
    await expect(spatial(page)).toContainText("16 m² requeridos");
    await expect(spatial(page)).toContainText("30 m² disponibles");

    await addFromCatalog(page, "Pista de baile");
    // El exceso es una advertencia, no un rechazo: la segunda pista se guarda.
    await expect(leafRow(contents(page), "Pista de baile")).toContainText("×2");
    await expect(spatial(page)).toContainText("Compatibilidad espacial excedida");
    await expect(spatial(page)).toContainText("32 m² requeridos");
    await expect(spatial(page)).toContainText("30 m² disponibles");
  });

  test("otra capacidad cambia el resultado y el Composite se despliega con arco + mesa", async ({ page }) => {
    await signIn(page);
    await createEvent(page, "Fiesta Composite", "Salón social", "50");

    await expect(fact(eventSummary(page), "Tipo de espacio")).toHaveText("Salón social");
    await expect(fact(eventSummary(page), "Área disponible")).toHaveText("50 m²");

    await addFromCatalog(page, "Pista de baile");
    await expect(leafRow(contents(page), "Pista de baile")).toContainText("×1");
    await addFromCatalog(page, "Pista de baile");
    await expect(leafRow(contents(page), "Pista de baile")).toContainText("×2");
    // El mismo exceso de la prueba anterior no aparece aquí: la compatibilidad
    // es un valor derivado del área disponible.
    await expect(spatial(page)).toContainText("Compatibilidad espacial: compatible");
    await expect(spatial(page)).toContainText("32 m² requeridos");
    await expect(spatial(page)).toContainText("50 m² disponibles");

    await page.getByRole("button", { name: "Agregar Zona de bienvenida" }).click();
    const zona = contents(page).getByRole("button", { name: /Zona de bienvenida/ });
    await expect(zona).toHaveAttribute("aria-expanded", "false");
    await expect(spatial(page)).toContainText("38 m² requeridos");

    await zona.click();
    await expect(zona).toHaveAttribute("aria-expanded", "true");
    const children = page.locator(`#${await zona.getAttribute("aria-controls")}`);
    await expect(children.getByText("Arco floral", { exact: true })).toBeVisible();
    await expect(children.getByText("Mesa redonda", { exact: true })).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("el total confirmado viene de Presupuesto", async ({ page }) => {
    await signIn(page);
    await createEvent(page, "Evento Presupuesto", "Casa", "30");

    const budget = page.getByRole("region", { name: "Presupuesto" });
    await expect(budget).toContainText("Presupuesto aún no calculado");

    await addFromCatalog(page, "Arco floral");
    await expect(leafRow(contents(page), "Arco floral")).toContainText("×1");
    await expect(budget).toContainText("Total confirmado");
    await expect(budget.getByRole("status")).toContainText("200.000");
  });

  test("Prototype: el clon es independiente del original", async ({ page }) => {
    await signIn(page);
    await createEvent(page, "Evento Prototype", "Salón social", "50");
    const originalUrl = page.url();

    await addFromCatalog(page, "Pista de baile");
    await expect(leafRow(contents(page), "Pista de baile")).toContainText("×1");
    await addFromCatalog(page, "Pista de baile");
    await expect(leafRow(contents(page), "Pista de baile")).toContainText("×2");

    await page.getByRole("button", { name: "Duplicar evento" }).click();
    await expect(page).not.toHaveURL(originalUrl);
    await expect(page).toHaveURL(PACKAGE_URL);
    await expect(leafRow(contents(page), "Pista de baile")).toContainText("×2");

    await contents(page).getByRole("button", { name: "Quitar una unidad de Pista de baile" }).click();
    await expect(leafRow(contents(page), "Pista de baile")).toContainText("×1");
    // El clon queda con una sola pista: 16 m² requeridos de 50 m² disponibles.
    await expect(spatial(page)).toContainText("16 m² requeridos");
    await expect(spatial(page)).toContainText("50 m² disponibles");

    await page.goto(originalUrl);
    await expect(leafRow(contents(page), "Pista de baile")).toContainText("×2");
    // El original no cambió: conserva las dos pistas (32 m² requeridos).
    await expect(spatial(page)).toContainText("32 m² requeridos");
    await expect(spatial(page)).toContainText("50 m² disponibles");
  });

  test("un evento de otro usuario o inexistente responde 404 sin revelar que existe", async ({ page }) => {
    const foreign = await admin
      .from("packages")
      .insert({ capacity_m2: 30, name: "Evento ajeno E2E", space_type: "casa", user_id: otherUserId })
      .select("id")
      .single<{ id: string }>();
    if (foreign.error) throw foreign.error;

    await signIn(page);

    const foreignResponse = await page.goto(`/packages/${foreign.data.id}`);
    expect(foreignResponse?.status()).toBe(404);

    const missingResponse = await page.goto(`/packages/${randomUUID()}`);
    expect(missingResponse?.status()).toBe(404);
  });
});
