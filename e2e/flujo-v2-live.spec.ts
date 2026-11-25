/**
 * DECOR-49 + rediseño visual móvil: navegación principal del recorrido V2 en
 * celular, contra la API real: Evento → Objetos → Montaje 3D → Cotización →
 * Compartir. El evento se recorre con la barra inferior de secciones.
 *
 * Opt-in: solo corre con DECOR_LIVE_SMOKE=1 y las variables de Supabase, porque
 * crea un usuario real (admin API, `email_confirm: true`) que se elimina al
 * final. El servidor debe estar en modo live. Crear el enlace público usa
 * DECOR-53, así que también hacen falta DECOR_SHARE_LINK_SECRET y
 * DECOR_PUBLIC_APP_URL. Cada prueba graba video (evidencia de la entrega).
 *
 *   DECOR_LIVE_SMOKE=1 NEXT_PUBLIC_DECOR_PACKAGES_API=live node --env-file=.env.local node_modules/@playwright/test/cli.js test e2e/flujo-v2-live.spec.ts
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
const DAY_MS = 24 * 60 * 60 * 1000;
const PACKAGE_URL = /\/packages\/([0-9a-f-]{36})$/;
const QUOTE_URL = /\/quotes\/([0-9a-f-]{36})$/;
/** Mínimo táctil de DECOR-49 (44 px), con medio píxel de tolerancia por redondeo. */
const MIN_TOUCH_PX = 43.5;

type CatalogModule = { readonly id: string; readonly name: string };

test.use({ video: "on", viewport: { height: 780, width: 360 } });

test.describe.serial("DECOR-49 recorrido V2 en celular", () => {
  test.skip(!enabled, disabledReason);

  const admin = enabled ? createClient(url, serviceRoleKey, noSession) : (null as never);
  const email = `decor49-e2e-${randomUUID()}@decorar.test`;
  const password = `${randomUUID()}Aa1!`;
  let userId: string | null = null;

  test.beforeAll(async () => {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    userId = created.data.user.id;
  });

  test.afterAll(async () => {
    if (userId) {
      await admin.from("packages").delete().eq("user_id", userId);
      await admin.auth.admin.deleteUser(userId);
    }
  });

  async function signIn(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/packages$/);
  }

  /** Pasos del recorrido en la lista de eventos (DECOR-49). */
  const steps = (page: Page) => page.getByRole("navigation", { name: "Pasos para preparar tu evento" });
  /** Barra inferior de secciones del evento (rediseño visual móvil). */
  const sections = (page: Page) => page.getByRole("navigation", { name: "Secciones del evento" });
  const currentSection = (page: Page) => sections(page).locator("[aria-current='page']");

  async function expectTouchTarget(target: Locator) {
    const box = await target.boundingBox();
    expect(box, "el control debe estar visible").not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
  }

  async function expectNoHorizontalOverflow(page: Page) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
  }

  test("de crear el evento a compartir la cotización, siempre se ve el siguiente paso", async ({ page }) => {
    // Recorrido completo con visor 3D y cotización: más largo que el límite por defecto.
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    // 1 · Evento
    await signIn(page);
    await expect(steps(page).locator("[aria-current='step']")).toHaveText(/Evento/);
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "Nuevo evento" }).click();
    await page.getByLabel("Nombre del evento").fill(`Flujo V2 ${randomUUID().slice(0, 8)}`);
    await page.getByRole("button", { name: "Crear evento" }).click();
    await expect(page).toHaveURL(PACKAGE_URL, { timeout: 60_000 });
    const packageId = PACKAGE_URL.exec(page.url())![1]!;

    // La sección Evento abre por defecto y dice qué sigue.
    await expect(currentSection(page)).toHaveAttribute("aria-label", "Evento");
    await expect(page.getByRole("heading", { name: "Agrega los elementos de tu evento" })).toBeVisible();
    for (const link of await sections(page).getByRole("link").all()) await expectTouchTarget(link);
    await expectNoHorizontalOverflow(page);

    // 2 · Objetos: sin elementos no se puede cotizar.
    await sections(page).getByRole("link", { name: "Cotizaciones" }).click();
    await expect(page).toHaveURL(new RegExp(`/packages/${packageId}\\?seccion=cotizar$`));
    await expect(page.getByText(/Agrega al menos un elemento del catálogo para poder cotizar/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Generar cotización" })).toHaveCount(0);

    const catalog = (await (await page.request.get("/api/modules")).json()) as CatalogModule[];
    expect(catalog.length, "el catálogo live debe tener módulos activos").toBeGreaterThan(0);
    const moduleName = catalog[0]!.name;

    await page.getByRole("link", { name: "Ir al catálogo" }).click();
    await expect(page).toHaveURL(new RegExp(`/packages/${packageId}\\?seccion=catalogo$`));
    await expect(currentSection(page)).toHaveAttribute("aria-label", "Catálogo");

    // Agregar desde la hoja inferior: dos unidades y el aviso de confirmación.
    await page.getByRole("button", { name: `Agregar ${moduleName}`, exact: true }).click();
    const sheet = page.getByRole("dialog", { name: moduleName });
    await expect(sheet).toBeVisible();
    await expectTouchTarget(sheet.getByRole("button", { name: `Aumentar cantidad de ${moduleName}` }));
    await sheet.getByRole("button", { name: `Aumentar cantidad de ${moduleName}` }).click();
    await sheet.getByRole("button", { name: `Agregar 2 unidades de ${moduleName}` }).click();
    await expect(sheet).toBeHidden({ timeout: 30_000 });
    await expect(page.locator(".catalog-toast")).toContainText(`2 × ${moduleName} agregados`);
    // El contador de Objetos de la barra inferior refleja las unidades.
    await expect(sections(page).getByRole("link", { name: "Objetos (2)" })).toBeVisible({ timeout: 30_000 });

    // 3 · Montaje 3D: el visor individual dentro de la sección Catálogo.
    await page.getByRole("link", { name: `Ver ${moduleName} en 3D` }).click();
    await expect(page).toHaveURL(new RegExp(`/packages/${packageId}/modules/`), { timeout: 60_000 });
    await expect(currentSection(page)).toHaveAttribute("aria-label", "Catálogo");
    await expectNoHorizontalOverflow(page);
    await page.getByRole("link", { name: "Volver al catálogo", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/packages/${packageId}\\?seccion=catalogo$`), { timeout: 30_000 });

    // El evento ahora invita a cotizar.
    await sections(page).getByRole("link", { name: "Evento", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Crea la cotización" })).toBeVisible();
    await page.getByRole("link", { name: "Crear la cotización" }).click();
    await expect(page).toHaveURL(new RegExp(`/packages/${packageId}\\?seccion=cotizar$`));

    // 4 · Cotización
    await expect(page.getByRole("region", { name: "Tus cotizaciones" })).toContainText(
      "Todavía no has creado cotizaciones para este evento.",
    );
    await page.getByRole("button", { name: "Generar cotización" }).click();
    await page.getByLabel("Válida hasta").fill(new Date(Date.now() + 30 * DAY_MS).toISOString().slice(0, 10));
    await page.getByRole("button", { name: "Generar y revisar" }).click();
    await expect(page).toHaveURL(QUOTE_URL, { timeout: 60_000 });
    await expect(currentSection(page)).toHaveAttribute("aria-label", "Cotizaciones");
    await expectNoHorizontalOverflow(page);

    // 5 · Compartir: marcar como enviada habilita el enlace público y WhatsApp.
    const send = page.getByRole("button", { name: "Marcar como enviada" });
    await expectTouchTarget(send);
    await send.click();
    await expect(page.getByRole("heading", { name: "Enlace para el cliente" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Compartir con tu cliente" })).toHaveCount(0);
    await page.getByRole("button", { name: "Crear enlace" }).click();
    await expect(page.getByRole("textbox", { name: "Enlace público" })).toHaveValue(/\/c\//);
    await expect(page.getByRole("link", { name: "Enviar por WhatsApp" })).toBeVisible();

    // De vuelta a Cotizaciones, la cotización queda a mano y ya figura como enviada.
    await page.getByRole("link", { name: "Cotizaciones", exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/packages/${packageId}\\?seccion=cotizar$`));
    const quotes = page.getByRole("region", { name: "Tus cotizaciones" });
    await expect(quotes.getByRole("link", { name: /Cotización N\.º \d+ · versión 1/ })).toBeVisible();
    await expect(quotes).toContainText("Enviada");

    expect(errors).toEqual([]);
  });

  test("con teclado el foco es visible en la barra de secciones", async ({ page }) => {
    await signIn(page);
    const created = await page.request.post("/api/packages", { data: { name: "Evento teclado V2" } });
    expect(created.status(), await created.text()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    await page.goto(`/packages/${id}`);
    // Al cargar, el título toma el foco (PageHeading): se espera para que no
    // le quite el foco a la barra a mitad de la prueba.
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();

    // Se llega con Tab desde la sección actual para que aplique :focus-visible.
    await sections(page).getByRole("link", { name: "Evento", exact: true }).focus();
    await page.keyboard.press("Tab");
    const objetos = sections(page).getByRole("link", { name: "Objetos", exact: true });
    await expect(objetos).toBeFocused();
    const outline = await objetos.evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(outline).not.toBe("none");
  });
});
