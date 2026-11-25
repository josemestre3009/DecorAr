import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

const email = process.env.DECOR_E2E_EMAIL;
const password = process.env.DECOR_E2E_PASSWORD;
const hasCredentials = Boolean(email && password);
const missingCredentials = "requiere DECOR_E2E_EMAIL y DECOR_E2E_PASSWORD";

// Fixture de DECOR-28: misma forma que GET /api/modules. Mientras el seed deje
// los módulos en borrador, la API real responde [] y las tarjetas solo se
// pueden comprobar sirviendo este fixture con page.route.
const catalogFixture = readFileSync(resolve("public/fixtures/catalog-modules.json"), "utf8");

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email as string);
  await page.getByLabel("Contraseña").fill(password as string);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/packages$/);
}

async function hasNoHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

/** Registra cualquier petición del navegador a PostgREST (CRUD directo). */
function watchPostgrest(page: Page) {
  const calls: string[] = [];

  page.on("request", (request) => {
    if (request.url().includes("/rest/v1/")) {
      calls.push(request.url());
    }
  });

  return calls;
}

async function serveCatalog(page: Page, body = catalogFixture, status = 200) {
  await page.route("**/api/modules", (route) =>
    route.fulfill({ body, contentType: "application/json", status }),
  );
  // Los posters del fixture apuntan a example.com; no se depende de la red.
  await page.route("https://example.com/**", (route) => route.abort());
}

// Next.js inserta su propio anunciador de rutas con role="alert"; los errores de
// la aplicación se buscan dentro de <main>.
const appAlert = (page: Page) => page.getByRole("main").getByRole("alert");

/**
 * Comprueba que el control tiene el foco y que el contorno de :focus-visible se
 * ve. El foco se alcanza con el teclado real: asignarlo a mano no activaría
 * :focus-visible, que es justo lo que hay que comprobar (mismo criterio que
 * auth.spec.ts).
 */
async function expectVisibleFocus(control: Locator) {
  await expect(control).toBeFocused();

  const outline = await control.evaluate((element) => {
    const styles = getComputedStyle(element);

    return {
      color: styles.outlineColor,
      style: styles.outlineStyle,
      width: Number.parseFloat(styles.outlineWidth),
    };
  });

  expect(outline.style).toBe("solid");
  expect(outline.width).toBeGreaterThan(0);
  expect(outline.color).not.toBe("rgba(0, 0, 0, 0)");
}

/**
 * Crea un evento (DECOR-44): solo el nombre es obligatorio; el tipo de espacio y
 * el área son metadatos opcionales que se completan después.
 */
async function createEvent(page: Page, name = "Evento de prueba") {
  // El formulario vive en la hoja "Nuevo evento" (rediseño visual).
  await page.getByRole("button", { name: "Nuevo evento" }).click();
  await page.getByLabel("Nombre del evento").fill(name);
  await page.getByRole("button", { name: "Crear evento" }).click();
}

/**
 * Avanza con Tab hasta que el control reciba el foco real del teclado (necesario
 * para activar :focus-visible) y comprueba que el contorno se ve. Evita depender
 * del número exacto de controles que el configurador interpone antes del
 * catálogo, que cambia según el modo simulado o live.
 */
/**
 * Rediseño visual móvil: con la API real el evento se divide en secciones y
 * el catálogo vive en la suya; en modo simulado sigue en la misma página.
 */
async function openCatalog(page: Page) {
  const link = page
    .getByRole("navigation", { name: "Secciones del evento" })
    .getByRole("link", { name: "Catálogo", exact: true });
  if ((await link.count()) > 0) {
    await link.click();
    await expect(page).toHaveURL(/seccion=catalogo/);
  }
}

async function tabUntilVisibleFocus(page: Page, control: Locator, maxTabs = 30) {
  for (let tab = 0; tab < maxTabs; tab += 1) {
    if (await control.evaluate((element) => element === document.activeElement).catch(() => false)) {
      await expectVisibleFocus(control);
      return;
    }

    await page.keyboard.press("Tab");
  }

  await expectVisibleFocus(control);
}

test.describe("portada", () => {
  test("la llamada a la acción lleva a crear el evento y pide sesión", async ({ page }) => {
    await page.setViewportSize({ height: 720, width: 360 });
    await page.goto("/");

    const cta = page.getByRole("link", { name: "Empezar a Decorar" });
    await expect(cta).toBeVisible();
    expect(await hasNoHorizontalOverflow(page)).toBe(true);

    await cta.click();

    await expect(page).toHaveURL(/\/login$/);
  });

  test("la portada se recorre con el teclado y muestra el foco", async ({ page }) => {
    await page.goto("/");

    await page.keyboard.press("Tab");
    await expectVisibleFocus(page.getByRole("link", { name: "Empezar a Decorar" }));
    await page.keyboard.press("Tab");
    await expectVisibleFocus(page.getByRole("link", { name: "Inicia Sesión" }));
  });

  test("la página de un evento exige sesión", async ({ page }) => {
    await page.goto("/packages/paquete-de-prueba");

    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("creación de evento y catálogo", () => {
  test.skip(!hasCredentials, missingCredentials);

  test("crea el evento solo con el nombre, muestra el catálogo y agrega un módulo", async ({
    page,
  }) => {
    const postgrestCalls = watchPostgrest(page);
    await page.setViewportSize({ height: 720, width: 360 });
    await serveCatalog(page);
    await signIn(page);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tus eventos");
    expect(await hasNoHorizontalOverflow(page)).toBe(true);

    await createEvent(page, "Boda de prueba");

    await expect(page).toHaveURL(/\/packages\/[^/]+$/);
    // En live el título es el nombre del evento; en simulado, el genérico.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/Boda de prueba|Tu evento/);

    await openCatalog(page);
    const cards = page.getByRole("article");
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText("Mesa redonda");
    await expect(cards.first()).toContainText(/\$\s250\.000/);
    await expect(cards.first()).toContainText("4 m²");
    expect(await hasNoHorizontalOverflow(page)).toBe(true);

    // Varias unidades desde la hoja inferior (rediseño visual móvil).
    await cards.first().getByRole("button", { name: "Agregar Mesa redonda" }).click();
    const sheet = page.getByRole("dialog", { name: "Mesa redonda" });
    await expect(sheet).toBeVisible();
    const increaseMesa = sheet.getByRole("button", { name: "Aumentar cantidad de Mesa redonda" });
    await increaseMesa.click();
    await increaseMesa.click();
    await expect(sheet.getByRole("status")).toHaveText("3");
    expect(await hasNoHorizontalOverflow(page)).toBe(true);
    await sheet.getByRole("button", { name: "Agregar 3 unidades de Mesa redonda" }).click();

    await expect(page.getByText("3 unidades de Mesa redonda se agregaron a tu evento.")).toBeAttached();
    await expect(sheet).toBeHidden();
    await expect(cards.first()).toContainText("Agregado 3 veces");

    expect(postgrestCalls).toEqual([]);
  });

  test("muestra la carga y el estado vacío", async ({ page }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolveHeld) => (release = resolveHeld));

    await page.route("**/api/modules", async (route) => {
      await held;
      await route.fulfill({ body: "[]", contentType: "application/json", status: 200 });
    });
    await signIn(page);
    await createEvent(page);
    await openCatalog(page);

    await expect(page.getByText("Cargando catálogo…")).toBeVisible();

    release();

    await expect(
      page.getByText("Todavía no hay módulos disponibles en el catálogo."),
    ).toBeVisible();
  });

  test("muestra el error y se recupera al reintentar", async ({ page }) => {
    // Falla hasta que se pulsa "Reintentar". No se cuentan peticiones: en
    // desarrollo, StrictMode ejecuta el efecto dos veces y cancela la primera.
    let failing = true;

    await page.route("**/api/modules", (route) =>
      failing
        ? route.fulfill({
            body: JSON.stringify({ error: "Internal Server Error", correlationId: "e2e" }),
            contentType: "application/json",
            status: 500,
          })
        : route.fulfill({ body: catalogFixture, contentType: "application/json", status: 200 }),
    );
    await page.route("https://example.com/**", (route) => route.abort());
    await signIn(page);
    await createEvent(page);
    await openCatalog(page);

    await expect(appAlert(page)).toContainText("No pudimos cargar el catálogo.");

    failing = false;
    await page.getByRole("button", { name: "Reintentar" }).click();

    await expect(page.getByRole("article")).toHaveCount(3);
  });
  test("todo el recorrido se completa solo con el teclado y con foco visible", async ({
    page,
  }) => {
    await serveCatalog(page);
    await signIn(page);
    // Carga limpia: tras el login el foco queda donde lo dejó la navegación, y
    // el recorrido debe empezar desde el principio de la página.
    await page.goto("/packages");

    // El menú de cuenta y "Nuevo evento" se alcanzan con Tab y foco visible.
    await page.keyboard.press("Tab");
    await expectVisibleFocus(page.getByRole("button", { name: "Tu cuenta" }));
    await page.keyboard.press("Tab");
    const newEvent = page.getByRole("button", { name: "Nuevo evento" });
    await expectVisibleFocus(newEvent);
    await page.keyboard.press("Enter");

    // Crear el evento (DECOR-44) en la hoja: el foco empieza en el nombre, que es
    // lo único obligatorio. Los detalles opcionales quedan plegados.
    const name = page.getByLabel("Nombre del evento");
    await expect(name).toBeFocused();
    await page.keyboard.type("Evento de teclado");

    await page.keyboard.press("Tab");
    await expectVisibleFocus(page.getByText("Agregar detalles (opcional)", { exact: true }));

    await page.keyboard.press("Tab");
    const submit = page.getByRole("button", { name: "Crear evento" });
    await expectVisibleFocus(submit);
    await page.keyboard.press("Enter");

    // Catálogo: al llegar, el foco pasa al título para que el recorrido empiece
    // arriba de la página nueva y no donde estaba el formulario.
    await expect(page).toHaveURL(/\/packages\/[^/]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await openCatalog(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
    await expect(page.getByRole("article")).toHaveCount(3);

    // El "+" de la mesa (primera tarjeta) se alcanza con Tab desde el título y
    // abre la hoja inferior con Enter.
    const openMesa = page.getByRole("button", { name: "Agregar Mesa redonda" });
    await tabUntilVisibleFocus(page, openMesa);
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog", { name: "Mesa redonda" });
    await expect(sheet).toBeVisible();

    // Dentro de la hoja el foco queda atrapado y se recorre con Tab.
    const increaseMesa = sheet.getByRole("button", { name: "Aumentar cantidad de Mesa redonda" });
    await tabUntilVisibleFocus(page, increaseMesa);
    await page.keyboard.press("Enter");
    await expect(sheet.getByRole("status")).toHaveText("2");

    await page.keyboard.press("Tab");
    const addMesa = sheet.getByRole("button", { name: "Agregar 2 unidades de Mesa redonda" });
    await expectVisibleFocus(addMesa);

    await page.keyboard.press("Enter");

    await expect(page.getByText("2 unidades de Mesa redonda se agregaron a tu evento.")).toBeAttached();
    // Tras el éxito la hoja se cierra y el foco vuelve al "+" de la tarjeta.
    await expect(sheet).toBeHidden();
    await expectVisibleFocus(page.getByRole("button", { name: "Agregar Mesa redonda" }));
  });
});
