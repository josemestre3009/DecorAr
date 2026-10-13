/**
 * DECOR-44: recorrido live de eventos y plantillas privadas contra la API real
 * y el Supabase alojado.
 *
 * Opt-in: solo corre con DECOR_LIVE_SMOKE=1, NEXT_PUBLIC_DECOR_PACKAGES_API=live
 * y las variables de Supabase, porque crea un usuario real (admin API,
 * `email_confirm: true`) que se elimina al final; sus eventos, ítems y
 * plantillas se borran en cascada (`packages.user_id` y
 * `event_templates.owner_id`). Playwright levanta `npm run dev` heredando
 * NEXT_PUBLIC_DECOR_PACKAGES_API. Cada prueba graba video (evidencia).
 *
 *   DECOR_LIVE_SMOKE=1 NEXT_PUBLIC_DECOR_PACKAGES_API=live node --env-file=.env.local node_modules/@playwright/test/cli.js test e2e/event-templates-live.spec.ts
 *
 * Requiere la migración 20261015000000_event_templates_and_metadata.sql aplicada
 * en el alojado y, para "configurar módulo", al menos un módulo activo en el
 * catálogo (igual que package-configurator-live.spec.ts). El recorrido no fuerza
 * viewport: la prueba de teclado recorre escritorio y móvil en el mismo caso.
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
const VIEWPORTS = [
  { height: 800, label: "escritorio", width: 1280 },
  { height: 720, label: "móvil", width: 360 },
] as const;

type CatalogModule = { id: string; name: string };
type TemplateRow = { id: string; name: string };

test.use({ video: "on" });

test.describe.serial("DECOR-44 eventos y plantillas contra la API real", () => {
  test.skip(!enabled, disabledReason);

  const admin = enabled ? createClient(url, serviceRoleKey, noSession) : (null as never);
  const email = `decor44-e2e-${randomUUID()}@decorar.test`;
  const password = `${randomUUID()}Aa1!`;
  let userId: string | null = null;

  test.beforeAll(async () => {
    const created = await admin.auth.admin.createUser({ email, email_confirm: true, password });
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

  const summary = (page: Page) =>
    page.getByRole("region", { name: "Datos del evento", exact: true });
  const contents = (page: Page) =>
    page.getByRole("region", { name: "Contenido del evento", exact: true });
  const templates = (page: Page) =>
    page.getByRole("region", { name: "Plantillas", exact: true });
  const saveTemplate = (page: Page) =>
    page.getByRole("region", { name: "Plantilla", exact: true });

  /** Valor de un dato del evento dentro de la lista de definiciones. */
  const fact = (region: Locator, label: string) => region.locator(`dt:text-is("${label}") + dd`);

  const eventId = (page: Page) => page.url().split("/").filter(Boolean).pop() as string;

  const noOverflow = (page: Page) =>
    page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

  test("evento mínimo → configurar → plantilla → segundo evento independiente sin cliente/fecha/lugar", async ({
    page,
  }) => {
    await signIn(page);

    // Evento mínimo: solo el nombre, sin espacio ni área.
    await page.getByLabel("Nombre del evento").fill(`Boda mínima ${randomUUID().slice(0, 8)}`);
    await page.getByRole("button", { name: "Crear evento" }).click();
    await expect(page).toHaveURL(PACKAGE_URL);

    const sourceId = eventId(page);
    await expect(summary(page)).toContainText("Compatibilidad espacial pendiente");
    expect(await fact(summary(page), "Cliente").innerText()).toBe("Sin definir");

    // Configurar: agregar un módulo del catálogo (por la API, sin depender de
    // selectores del catálogo) y comprobar que el contenido lo refleja.
    const catalog = (await (await page.request.get("/api/modules")).json()) as CatalogModule[];
    expect(catalog.length, "el catálogo live debe tener módulos activos").toBeGreaterThan(0);
    const catalogModule = catalog[0];
    const added = await page.request.post(`/api/packages/${sourceId}/items`, {
      data: { moduleId: catalogModule.id },
    });
    expect(added.status(), await added.text()).toBe(201);
    await page.reload();
    await expect(contents(page)).toContainText(catalogModule.name);

    // Datos específicos del evento fuente: cliente, fecha y lugar.
    await page.getByRole("button", { name: "Editar datos" }).click();
    await page.getByLabel("Cliente").fill("Cliente E2E");
    await page.getByLabel("Fecha").fill("2026-12-31");
    await page.getByLabel("Lugar").fill("Salón E2E");
    await page.getByRole("button", { name: "Guardar datos" }).click();
    await expect(fact(summary(page), "Cliente")).toHaveText("Cliente E2E");
    await expect(fact(summary(page), "Lugar")).toHaveText("Salón E2E");
    await expect(fact(summary(page), "Fecha")).toContainText("2026");

    // Guardar como plantilla y anuncio accesible del resultado.
    const templateName = `Plantilla E2E ${randomUUID().slice(0, 8)}`;
    const saveRegion = saveTemplate(page);
    await saveRegion.getByRole("button", { name: "Guardar como plantilla" }).click();
    await saveRegion.getByLabel("Nombre de la plantilla").fill(templateName);
    await saveRegion.getByRole("button", { name: "Guardar plantilla" }).click();
    await expect(saveRegion.getByRole("status")).toContainText(`Plantilla "${templateName}" guardada.`);

    // La plantilla privada aparece en /packages.
    await page.getByRole("link", { name: "← Eventos" }).click();
    await expect(page).toHaveURL(/\/packages$/);
    const list = templates(page);
    await expect(list.getByRole("heading", { name: templateName })).toBeVisible();

    // Crear un segundo evento desde la plantilla pidiendo un nombre.
    await list.getByRole("button", { name: `Usar plantilla ${templateName}` }).click();
    const useForm = list.getByRole("form", { name: `Crear evento desde ${templateName}` });
    await useForm.getByLabel("Nombre del evento").fill("Evento desde plantilla E2E");
    await useForm.getByRole("button", { name: "Crear evento" }).click();
    await expect(page).toHaveURL(PACKAGE_URL);

    const secondId = eventId(page);
    expect(secondId).not.toBe(sourceId);

    // Configuración copiada, pero sin cliente, fecha ni lugar heredados.
    await expect(contents(page)).toContainText(catalogModule.name);
    expect(await fact(summary(page), "Cliente").innerText()).toBe("Sin definir");
    expect(await fact(summary(page), "Fecha").innerText()).toBe("Sin definir");
    expect(await fact(summary(page), "Lugar").innerText()).toBe("Sin definir");

    // Identificadores nuevos e independientes, comprobados en la base.
    const template = await admin
      .from("event_templates")
      .select("id, name")
      .eq("owner_id", userId!)
      .eq("name", templateName)
      .single<TemplateRow>();
    if (template.error) throw template.error;

    const templateItems = await admin
      .from("event_template_items")
      .select("id")
      .eq("template_id", template.data.id);
    const sourceItems = await admin.from("package_items").select("id").eq("package_id", sourceId);
    const secondItems = await admin.from("package_items").select("id").eq("package_id", secondId);

    expect([templateItems.data?.length, sourceItems.data?.length, secondItems.data?.length]).toEqual([1, 1, 1]);
    const ids = new Set([templateItems.data![0].id, sourceItems.data![0].id, secondItems.data![0].id]);
    expect(ids.size).toBe(3);

    // Modificar el segundo evento no altera la plantilla ni el evento fuente.
    await contents(page).getByRole("button", { name: `Quitar una unidad de ${catalogModule.name}` }).click();
    await expect(contents(page)).toContainText("Tu evento todavía no tiene elementos.");

    const templateAfter = await admin
      .from("event_template_items")
      .select("id")
      .eq("template_id", template.data.id);
    const sourceAfter = await admin.from("package_items").select("id").eq("package_id", sourceId);
    expect(templateAfter.data?.length).toBe(1);
    expect(sourceAfter.data?.length).toBe(1);

    expect(await noOverflow(page)).toBe(true);
  });

  test("teclado y anuncios de plantilla en escritorio y móvil sin duplicar el caso", async ({
    page,
  }) => {
    await signIn(page);

    const created = await page.request.post("/api/packages", {
      data: { name: `Evento teclado ${randomUUID().slice(0, 8)}` },
    });
    expect(created.status(), await created.text()).toBe(201);
    const packageId = ((await created.json()) as { id: string }).id;

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ height: viewport.height, width: viewport.width });
      await page.goto(`/packages/${packageId}`);

      const region = saveTemplate(page);
      const toggle = region.getByRole("button", { name: "Guardar como plantilla" });

      // Abrir el formulario con el teclado; el foco entra al campo.
      await toggle.focus();
      await expect(toggle).toBeFocused();
      await toggle.press("Enter");

      const input = region.getByLabel("Nombre de la plantilla");
      await expect(input).toBeVisible();
      await expect(input).toBeFocused();

      // Nombre vacío: error asociado al campo y foco recuperable.
      await input.fill("");
      await page.keyboard.press("Enter");
      await expect(region.getByRole("alert")).toContainText("obligatorio");
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(input).toBeFocused();

      // Nombre válido: anuncio del resultado para tecnologías de asistencia.
      const name = `Teclado ${viewport.label} ${randomUUID().slice(0, 8)}`;
      await input.fill(name);
      await page.keyboard.press("Enter");
      await expect(region.getByRole("status")).toContainText(`Plantilla "${name}" guardada.`);

      expect(await noOverflow(page)).toBe(true);
    }
  });
});
