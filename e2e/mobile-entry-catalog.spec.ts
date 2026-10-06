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

async function createPackage(page: Page, capacity = "30") {
  await page.getByLabel("Salón social").check();
  await page.getByLabel("Capacidad del espacio (m²)").fill(capacity);
  await page.getByRole("button", { name: "Crear paquete" }).click();
}

test.describe("portada", () => {
  test("la llamada a la acción lleva a crear el paquete y pide sesión", async ({ page }) => {
    await page.setViewportSize({ height: 720, width: 360 });
    await page.goto("/");

    const cta = page.getByRole("link", { name: "Crear mi paquete" });
    await expect(cta).toBeVisible();
    expect(await hasNoHorizontalOverflow(page)).toBe(true);

    await cta.click();

    await expect(page).toHaveURL(/\/login$/);
  });

  test("la portada se recorre con el teclado y muestra el foco", async ({ page }) => {
    await page.goto("/");

    await page.keyboard.press("Tab");
    await expectVisibleFocus(page.getByRole("link", { name: "DecorAR, inicio" }));
    await page.keyboard.press("Tab");
    await expectVisibleFocus(page.getByRole("link", { name: "Crear mi paquete" }));
    await page.keyboard.press("Tab");
    await expectVisibleFocus(page.getByRole("link", { name: "Conocer DecorAR" }));
  });

  test("la página de un paquete exige sesión", async ({ page }) => {
    await page.goto("/packages/paquete-de-prueba");

    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("definición del espacio y catálogo", () => {
  test.skip(!hasCredentials, missingCredentials);

  test("valida la capacidad, crea el paquete, muestra el catálogo y agrega un módulo", async ({
    page,
  }) => {
    const postgrestCalls = watchPostgrest(page);
    await page.setViewportSize({ height: 720, width: 360 });
    await serveCatalog(page);
    await signIn(page);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Define tu espacio");
    expect(await hasNoHorizontalOverflow(page)).toBe(true);

    // Cada tipo de valor rechazado tiene su propio mensaje.
    for (const [raw, message] of [
      ["treinta", "La capacidad debe escribirse con números, por ejemplo 30."],
      ["30m2", "No aceptamos este valor. Escribe solo números, por ejemplo 30 o 30,5."],
      ["0", "La capacidad debe ser mayor que 0."],
    ]) {
      await createPackage(page, raw);

      await expect(appAlert(page)).toHaveText(message);
      await expect(page.getByLabel("Capacidad del espacio (m²)")).toHaveValue(raw);
      await expect(page).toHaveURL(/\/packages$/);
    }

    await createPackage(page, "30,5");

    await expect(page).toHaveURL(/\/packages\/[^/]+$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tu paquete");

    const cards = page.getByRole("article");
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText("Mesa redonda");
    await expect(cards.first()).toContainText(/\$\s250\.000/);
    await expect(cards.first()).toContainText("4 m²");
    expect(await hasNoHorizontalOverflow(page)).toBe(true);

    await page.getByRole("button", { name: "Agregar Mesa redonda" }).click();

    await expect(page.getByText("Mesa redonda se agregó a tu paquete.")).toBeAttached();
    await expect(cards.first()).toContainText("Agregado a tu paquete");

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
    await createPackage(page);

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
    await createPackage(page);

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

    // Definir el espacio: el grupo de opciones es una sola parada de Tab y las
    // flechas cambian la opción elegida.
    await page.keyboard.press("Tab");
    await expectVisibleFocus(page.getByRole("radio", { name: "Casa" }));
    await page.keyboard.press("ArrowDown");
    const aireLibre = page.getByRole("radio", { name: "Aire libre (parque o playa)" });
    await expectVisibleFocus(aireLibre);
    await expect(aireLibre).toBeChecked();

    await page.keyboard.press("Tab");
    const capacity = page.getByLabel("Capacidad del espacio (m²)");
    await expectVisibleFocus(capacity);
    await page.keyboard.type("45");

    await page.keyboard.press("Tab");
    const submit = page.getByRole("button", { name: "Crear paquete" });
    await expectVisibleFocus(submit);

    await page.keyboard.press("Tab");
    await expectVisibleFocus(page.getByRole("button", { name: "Cerrar sesión" }));

    await page.keyboard.press("Shift+Tab");
    await expect(submit).toBeFocused();
    await page.keyboard.press("Enter");

    // Catálogo: al llegar, el foco pasa al título para que el recorrido empiece
    // arriba de la página nueva y no donde estaba el formulario.
    await expect(page).toHaveURL(/\/packages\/[^/]+$/);
    await expect(page.getByRole("heading", { level: 1, name: "Tu paquete" })).toBeFocused();
    await expect(page.getByRole("article")).toHaveCount(3);

    await page.keyboard.press("Tab");
    const addMesa = page.getByRole("button", { name: "Agregar Mesa redonda" });
    await expectVisibleFocus(addMesa);

    // El enlace de vuelta queda antes del título y se alcanza hacia atrás.
    await page.keyboard.press("Shift+Tab");
    await expectVisibleFocus(page.getByRole("link", { name: "← Cambiar espacio" }));
    await page.keyboard.press("Tab");
    await expect(addMesa).toBeFocused();

    await page.keyboard.press("Enter");

    await expect(page.getByText("Mesa redonda se agregó a tu paquete.")).toBeAttached();
    await expectVisibleFocus(addMesa);
  });
});
