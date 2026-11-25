/**
 * DECOR-49: navegación principal del recorrido V2 en celular, contra la API
 * real: Evento → Objetos → Montaje 3D → Cotización → Compartir.
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

import { devices, expect, test, type Locator, type Page } from "@playwright/test";

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

  const steps = (page: Page) => page.getByRole("navigation", { name: "Pasos para preparar tu evento" });
  const currentStep = (page: Page) => steps(page).locator("[aria-current='step']");

  async function expectTouchTarget(target: Locator) {
    const box = await target.boundingBox();
    expect(box, "el control debe estar visible").not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(MIN_TOUCH_PX);
  }

  async function expectNoHorizontalOverflow(page: Page) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
  }

  test("de crear el evento a compartir la cotización, siempre se ve el siguiente paso", async ({ browser, page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    // 1 · Evento
    await signIn(page);
    await expect(currentStep(page)).toHaveText(/Evento/);
    await expectNoHorizontalOverflow(page);
    await page.getByLabel("Nombre del evento").fill(`Flujo V2 ${randomUUID().slice(0, 8)}`);
    await page.getByRole("button", { name: "Crear evento" }).click();
    await expect(page).toHaveURL(PACKAGE_URL, { timeout: 60_000 });
    const packageId = PACKAGE_URL.exec(page.url())![1]!;

    // 2 · Objetos: sin elementos, el siguiente paso es el catálogo y no se puede cotizar.
    await expect(currentStep(page)).toHaveText(/Objetos/);
    await expect(page.getByRole("heading", { name: "Agrega los elementos de tu evento" })).toBeVisible();
    await expect(page.getByText(/Agrega al menos un elemento del catálogo para poder cotizar/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Generar cotización" })).toHaveCount(0);
    for (const link of await steps(page).getByRole("link").all()) await expectTouchTarget(link);
    await expectNoHorizontalOverflow(page);

    const catalog = (await (await page.request.get("/api/modules")).json()) as CatalogModule[];
    expect(catalog.length, "el catálogo live debe tener módulos activos").toBeGreaterThan(0);
    const moduleName = catalog[0]!.name;

    // El aviso de cotización también ofrece "Ir al catálogo"; se usa el del siguiente paso.
    await page.getByRole("complementary", { name: "Agrega los elementos de tu evento" })
      .getByRole("link", { name: "Ir al catálogo" })
      .click();
    await expect(page).toHaveURL(new RegExp(`/packages/${packageId}#catalogo$`));
    await page.getByRole("button", { name: `Agregar ${moduleName}`, exact: true }).click();

    // Con elementos, el siguiente paso invita a verlos en 3D y a cotizar.
    await expect(page.getByRole("heading", { name: "Mira tu montaje y crea la cotización" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(currentStep(page)).toHaveText(/Cotización/);
    await expectTouchTarget(page.getByRole("link", { name: "Crear la cotización" }));

    // 3 · Montaje 3D: el visor individual, con su paso marcado.
    await steps(page).getByRole("link", { name: "Montaje 3D" }).click();
    await expect(page.locator("#montaje")).toBeInViewport();
    await page.getByRole("link", { name: `Ver ${moduleName} en 3D` }).click();
    await expect(page).toHaveURL(new RegExp(`/packages/${packageId}/modules/`), { timeout: 60_000 });
    await expect(currentStep(page)).toHaveText(/Montaje 3D/);
    await expectNoHorizontalOverflow(page);
    await page.getByRole("link", { name: "← Volver al catálogo" }).click();
    await expect(page).toHaveURL(new RegExp(`/packages/${packageId}#catalogo$`));

    // 4 · Cotización: se crea desde su sección y la lista del evento la muestra.
    await page.getByRole("link", { name: "Crear la cotización" }).click();
    await expect(page.getByRole("region", { name: "Tus cotizaciones" })).toContainText(
      "Todavía no has creado cotizaciones para este evento.",
    );
    await page.getByRole("button", { name: "Generar cotización" }).click();
    await page.getByLabel("Válida hasta").fill(new Date(Date.now() + 30 * DAY_MS).toISOString().slice(0, 10));
    await page.getByRole("button", { name: "Generar y revisar" }).click();
    await expect(page).toHaveURL(QUOTE_URL, { timeout: 60_000 });
    await expect(currentStep(page)).toHaveText(/Cotización/);
    await expect(steps(page).getByRole("link", { name: "Compartir" })).toHaveAttribute("href", /#compartir$/);
    await expectNoHorizontalOverflow(page);

    // 5 · Compartir: marcar como enviada habilita el enlace público y WhatsApp.
    const send = page.getByRole("button", { name: "Marcar como enviada" });
    await expectTouchTarget(send);
    await send.click();
    await expect(page.getByRole("heading", { name: "Enlace para el cliente" })).toBeVisible({ timeout: 30_000 });
    await expect(currentStep(page)).toHaveText(/Compartir/);
    await expect(page.getByRole("heading", { name: "Compartir con tu cliente" })).toHaveCount(0);
    await page.getByRole("button", { name: "Crear enlace" }).click();
    const shareUrl = await page.getByRole("textbox", { name: "Enlace público" }).inputValue();
    expect(shareUrl).toMatch(/\/c\//);
    await expect(page.getByRole("link", { name: "Enviar por WhatsApp" })).toBeVisible();

    // 6 · Cliente sin sesión abre el enlace público y descarga el PDF (DECOR-56).
    const anonymous = await browser.newContext({ ...devices["Pixel 7"], baseURL: test.info().project.use.baseURL });
    try {
      const publicPage = await anonymous.newPage();
      const publicResponse = await publicPage.goto(new URL(shareUrl).pathname);
      expect(publicResponse?.status()).toBe(200);
      await expectNoHorizontalOverflow(publicPage);

      const downloadLink = publicPage.getByRole("link", { name: "Descargar PDF" });
      await expectTouchTarget(downloadLink);
      const pdfHref = await downloadLink.getAttribute("href");
      expect(pdfHref).toMatch(/^\/api\/c\/.+\/pdf$/);

      const pdfResponse = await anonymous.request.get(pdfHref!);
      expect(pdfResponse.status()).toBe(200);
      expect(pdfResponse.headers()["content-type"]).toContain("application/pdf");
      expect((await pdfResponse.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
    } finally {
      await anonymous.close();
    }

    // De vuelta al evento, la cotización queda a mano y ya figura como enviada.
    await page.getByRole("link", { name: "← Evento" }).click();
    await expect(page).toHaveURL(new RegExp(`/packages/${packageId}$`));
    const quotes = page.getByRole("region", { name: "Tus cotizaciones" });
    await expect(quotes.getByRole("link", { name: /Cotización N\.º \d+ · versión 1/ })).toBeVisible();
    await expect(quotes).toContainText("Enviada");

    expect(errors).toEqual([]);
  });

  test("con teclado el foco es visible en los pasos", async ({ page }) => {
    await signIn(page);
    const created = await page.request.post("/api/packages", { data: { name: "Evento teclado V2" } });
    expect(created.status(), await created.text()).toBe(201);
    const { id } = (await created.json()) as { id: string };
    await page.goto(`/packages/${id}`);

    // Evento vacío: "Objetos" es el paso actual (sin enlace), así que Shift+Tab
    // desde "Montaje 3D" llega a "Evento" por teclado y aplica :focus-visible.
    const firstStep = steps(page).getByRole("link", { name: "Evento" });
    await expect(currentStep(page)).toHaveText(/Objetos/);
    await steps(page).getByRole("link", { name: "Montaje 3D" }).focus();
    await page.keyboard.press("Shift+Tab");
    await expect(firstStep).toBeFocused();
    const outline = await firstStep.evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(outline).not.toBe("none");
  });
});
