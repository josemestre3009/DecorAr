/**
 * DECOR-43: organización de zonas contra la API real y el Supabase alojado.
 *
 * Recorre el flujo completo de la entrega: espacio → zonas → renombrar →
 * eliminar promoviendo contenido → catálogo → duplicación → independencia
 * del original. Opt-in como el resto de pruebas live: crea un usuario real
 * que se elimina al final (sus paquetes, zonas e ítems se borran en cascada).
 *
 *   DECOR_LIVE_SMOKE=1 NEXT_PUBLIC_DECOR_PACKAGES_API=live node --env-file=.env.local node_modules/@playwright/test/cli.js test e2e/package-group-management-live.spec.ts
 *
 * Requiere la migración 20261015000000_manage_package_groups.sql aplicada en
 * el alojado.
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
const GROUP_SETUP_URL = /\/packages\/[0-9a-f-]{36}\/groups\/setup$/;

test.use({ video: "on", viewport: { height: 780, width: 360 } });

test.describe.serial("DECOR-43 zonas contra la API real", () => {
  test.skip(!enabled, disabledReason);

  const admin = enabled ? createClient(url, serviceRoleKey, noSession) : (null as never);
  const email = `decor43-e2e-${randomUUID()}@decorar.test`;
  const password = `${randomUUID()}Aa1!`;
  let userId: string | null = null;

  test.beforeAll(async () => {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    userId = created.data.user.id;
  });

  test.afterAll(async () => {
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  async function signIn(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/packages$/);
  }

  async function createZone(page: Page, name: string, parentLabel?: string) {
    await page.getByLabel("Nombre de la zona").fill(name);
    await page.getByLabel("Ubicación").selectOption({ label: parentLabel ? `Dentro de ${parentLabel}` : "Nivel principal" });
    await page.getByRole("button", { name: "Crear zona" }).click();
    await expect(page.getByRole("status").first()).toContainText(`Zona «${name}» creada`);
  }

  const zoneRow = (page: Page, label: string) =>
    page.getByRole("listitem").filter({ has: page.getByRole("button", { name: `Renombrar ${label}`, exact: true }) });
  const contents = (page: Page) => page.getByRole("region", { name: "Contenido del paquete" });
  const facts = (page: Page) => page.getByRole("region", { name: "Tu espacio" }).getByRole("definition");

  async function expandGroup(scope: Locator, name: string): Promise<Locator> {
    const toggle = scope.getByRole("button", { name: new RegExp(`^${name}\\b`) });
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    return scope.page().locator(`#${await toggle.getAttribute("aria-controls")}`);
  }

  async function addTo(page: Page, destination: string, moduleName: string) {
    await page.getByLabel("Agregar en").selectOption({ label: destination });
    await page.getByRole("button", { name: `Agregar ${moduleName}` }).click();
    await expect(page.getByRole("status").filter({ hasText: `${moduleName} se agregó a la zona ${destination}.` })).toBeAttached();
  }

  test("espacio → zonas → renombrar → eliminar promoviendo → catálogo → duplicar sin tocar el original", async ({
    page,
  }) => {
    await signIn(page);

    // 1. Espacio: con la API real, crear el paquete lleva a organizar zonas.
    await page.getByLabel("Salón social").check();
    await page.getByLabel("Capacidad del espacio (m²)").fill("50");
    await page.getByRole("button", { name: "Crear paquete" }).click();
    await expect(page).toHaveURL(GROUP_SETUP_URL);
    await expect(page.getByRole("heading", { level: 1, name: "Organiza tus zonas" })).toBeVisible();
    const setupUrl = page.url();

    // 2. Zonas en tres niveles.
    await createZone(page, "Sala");
    await createZone(page, "Mesa", "Sala");
    await createZone(page, "Centro", "Sala › Mesa");
    await expect(page.getByLabel("Ubicación").getByRole("option", { name: "Dentro de Sala › Mesa › Centro" })).toHaveCount(0);

    // 3. Renombrar: un nombre vacío se rechaza y conserva el anterior; uno válido lo cambia.
    await page.getByRole("button", { name: "Renombrar Sala", exact: true }).click();
    await page.getByLabel("Nuevo nombre para «Sala»").fill("   ");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByRole("alert")).toContainText("entre 1 y 80 caracteres");
    await page.getByLabel("Nuevo nombre para «Sala»").fill("Sala principal");
    await page.getByRole("button", { name: "Guardar" }).click();
    await expect(page.getByRole("button", { name: "Renombrar Sala principal", exact: true })).toBeVisible();
    await expect(zoneRow(page, "Sala principal › Mesa")).toContainText("en Sala principal");

    // 4. Catálogo: elementos dentro de las zonas.
    await page.getByRole("link", { name: "Continuar al catálogo" }).click();
    await expect(page).toHaveURL(PACKAGE_URL);
    const packageUrl = page.url();
    await addTo(page, "Sala principal › Mesa", "Arco floral");
    await addTo(page, "Sala principal › Mesa › Centro", "Mesa redonda");
    await expect(facts(page)).toHaveText(["Salón social", "50 m²", "6 m²", "44 m²"]);

    // 5. Eliminar "Mesa": su arco y "Centro" suben a "Sala principal", sin perder nada.
    await page.getByRole("link", { name: "Administrar zonas" }).click();
    await expect(page).toHaveURL(setupUrl);
    await page.getByRole("button", { name: "Eliminar Sala principal › Mesa" }).click();
    const confirm = page.getByRole("group", { name: /¿Eliminar «Mesa»\?/ });
    await expect(confirm).toContainText("1 elemento y 1 subzona");
    await expect(confirm).toContainText("pasará a Sala principal");
    await confirm.getByRole("button", { name: "Sí, eliminar zona" }).click();
    await expect(page.getByRole("button", { name: "Renombrar Sala principal › Mesa" })).toHaveCount(0);
    await expect(zoneRow(page, "Sala principal › Centro")).toContainText("en Sala principal");

    await page.getByRole("link", { name: "Continuar al catálogo" }).click();
    await expect(page).toHaveURL(packageUrl);
    await expect(facts(page)).toHaveText(["Salón social", "50 m²", "6 m²", "44 m²"]);
    const sala = await expandGroup(contents(page), "Sala principal");
    await expect(sala.getByText("Arco floral", { exact: true })).toBeVisible();
    const centro = await expandGroup(sala, "Centro");
    await expect(centro.getByText("Mesa redonda", { exact: true })).toBeVisible();

    // 6. Duplicar: la copia conserva la jerarquía y avisa.
    await page.getByRole("button", { name: "Duplicar paquete" }).click();
    await expect(page).not.toHaveURL(packageUrl);
    await expect(page).toHaveURL(PACKAGE_URL);
    await expect(page.getByText("Copia creada.")).toBeVisible();
    const copySala = await expandGroup(contents(page), "Sala principal");
    await expect(copySala.getByText("Arco floral", { exact: true })).toBeVisible();
    await expect(await expandGroup(copySala, "Centro")).toContainText("Mesa redonda");

    // 7. Cambiar la copia no cambia el original.
    await page.getByRole("link", { name: "Administrar zonas" }).click();
    await page.getByRole("button", { name: "Eliminar Sala principal", exact: true }).click();
    await page.getByRole("button", { name: "Sí, eliminar zona" }).click();
    await expect(page.getByRole("button", { name: "Renombrar Sala principal", exact: true })).toHaveCount(0);

    await page.goto(setupUrl);
    await expect(page.getByRole("button", { name: "Renombrar Sala principal", exact: true })).toBeVisible();
    await expect(zoneRow(page, "Sala principal › Centro")).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("omitir las zonas lleva al configurador con agregado al nivel principal", async ({ page }) => {
    await signIn(page);
    await page.getByLabel("Casa").check();
    await page.getByLabel("Capacidad del espacio (m²)").fill("30");
    await page.getByRole("button", { name: "Crear paquete" }).click();
    await expect(page).toHaveURL(GROUP_SETUP_URL);

    await page.getByRole("link", { name: "Omitir por ahora" }).click();
    await expect(page).toHaveURL(PACKAGE_URL);
    await expect(page.getByLabel("Agregar en")).toHaveCount(0);

    await page.getByRole("button", { name: "Agregar Arco floral" }).click();
    await expect(facts(page)).toHaveText(["Casa", "30 m²", "2 m²", "28 m²"]);
  });
});
