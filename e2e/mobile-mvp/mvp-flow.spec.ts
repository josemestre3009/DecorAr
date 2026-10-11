/**
 * DECOR-39: flujo de demo del MVP en un Pixel 5, contra la API real.
 * El usuario A (sesión del setup) recorre en orden: espacio con capacidad
 * manual → catálogo → capacidad excedida → Composite → presupuesto confirmado
 * y resincronización → Prototype → vista 3D/AR (Android e iOS).
 */
import { expect, test } from "@playwright/test";

import type { SeededModule } from "../../scripts/seed-e2e";
import {
  BUDGET_URL,
  IPHONE_UA,
  STORAGE_A,
  addFromCatalog,
  appAlert,
  budget,
  contents,
  createPackage,
  facts,
  hasNoHorizontalOverflow,
  leafRow,
  parseCop,
  readSeed,
} from "./helpers";

test.use({ storageState: STORAGE_A });

type BudgetBody = { totalCop: number; currency: string; packageVersion: number };

test.describe.serial("DECOR-39 flujo móvil del MVP", () => {
  // seed.json lo escribe el proyecto mvp-setup, que corre antes que este.
  let arco: SeededModule;
  let mesa: SeededModule;
  let pista: SeededModule;
  let packagePath = "";

  test.beforeAll(() => {
    ({ arco, mesa, pista } = readSeed().catalog);
  });

  test("happy path: la sesión entra, define el espacio con capacidad manual y agrega desde el catálogo", async ({
    page,
  }) => {
    await createPackage(page, "Casa", "30");
    packagePath = new URL(page.url()).pathname;

    await expect(facts(page)).toHaveText(["Casa", "30 m²", "0 m²", "30 m²"]);
    await expect(page.getByRole("region", { name: "Catálogo" }).getByRole("heading", { name: pista.name })).toBeVisible();

    await addFromCatalog(page, pista.name);
    await expect(leafRow(contents(page), pista.name)).toContainText("×1");
    await expect(facts(page)).toHaveText(["Casa", "30 m²", "16 m²", "14 m²"]);
    expect(await hasNoHorizontalOverflow(page)).toBe(true);
  });

  test("capacidad excedida: la API responde 422 y la interfaz lo informa sin mutar", async ({ page }) => {
    await page.goto(packagePath);

    const rejected = page.waitForResponse(
      (response) => response.request().method() === "POST" && /\/items$/.test(new URL(response.url()).pathname),
    );
    await addFromCatalog(page, pista.name);
    const response = await rejected;

    expect(response.status()).toBe(422);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("package.capacity_exceeded");
    await expect(appAlert(page)).toContainText("excede la capacidad del espacio (32/30 m²)");
    await expect(leafRow(contents(page), pista.name)).toContainText("×1");
    await expect(facts(page)).toHaveText(["Casa", "30 m²", "16 m²", "14 m²"]);
  });

  test("Composite: la Zona de bienvenida agrupa arco y mesa", async ({ page }) => {
    await page.goto(packagePath);

    await page.getByRole("button", { name: "Agregar Zona de bienvenida" }).click();
    const zona = contents(page).getByRole("button", { name: /Zona de bienvenida/ });
    await expect(zona).toHaveAttribute("aria-expanded", "false");
    await expect(facts(page)).toHaveText(["Casa", "30 m²", "22 m²", "8 m²"]);

    await zona.click();
    await expect(zona).toHaveAttribute("aria-expanded", "true");
    const children = page.locator(`#${await zona.getAttribute("aria-controls")}`);
    await expect(children.getByText(arco.name, { exact: true })).toBeVisible();
    await expect(children.getByText(mesa.name, { exact: true })).toBeVisible();
  });

  test("presupuesto confirmado: la interfaz muestra el total que calculó Presupuesto", async ({ page }) => {
    await page.goto(packagePath);
    const packageId = packagePath.split("/").pop() as string;

    // Fuente de verdad: GET /budget. Pista + arco + mesa de la versión fijada.
    let confirmed: BudgetBody | null = null;
    await expect
      .poll(
        async () => {
          const response = await page.request.get(`/api/packages/${packageId}/budget`);
          confirmed = response.ok() ? ((await response.json()) as BudgetBody) : null;
          return confirmed?.totalCop ?? response.status();
        },
        { message: "el consumidor de Presupuesto no confirmó el total", timeout: 30_000 },
      )
      .toBeGreaterThan(0);

    const total = confirmed as unknown as BudgetBody;
    expect(total.currency).toBe("COP");

    const region = budget(page);
    await expect(region).toContainText("Total confirmado");
    await expect(region).toContainText(`versión ${total.packageVersion} del paquete`);
    expect(parseCop(await region.locator(".budget-amount strong").innerText())).toBe(total.totalCop);
  });

  test("resincronización: al volver la conexión se consulta /budget y se conserva el total", async ({
    page,
    context,
  }) => {
    await page.goto(packagePath);
    const region = budget(page);
    await expect(region).toContainText("Total confirmado");
    const shown = await region.locator(".budget-amount strong").innerText();

    // El hook escucha `online` desde que la página hidrata: se espera a que el
    // navegador se vea sin conexión antes de recuperarla, o no hay transición.
    await page.waitForLoadState("networkidle");
    await context.setOffline(true);
    await page.waitForFunction(() => !navigator.onLine);
    const resync = page.waitForResponse((response) => BUDGET_URL.test(new URL(response.url()).pathname));
    await context.setOffline(false);
    const response = await resync;

    expect(response.status()).toBe(200);
    expect(((await response.json()) as BudgetBody).totalCop).toBe(parseCop(shown));
    await expect(region.locator(".budget-amount strong")).toHaveText(shown);
    await expect(appAlert(page)).toHaveCount(0);
  });

  test("Prototype: el clon copia el contenido y es independiente del original", async ({ page }) => {
    await page.goto(packagePath);

    await page.getByRole("button", { name: "Duplicar paquete" }).click();
    await expect(page).not.toHaveURL(new RegExp(`${packagePath}$`));
    await expect(page).toHaveURL(/\/packages\/[0-9a-f-]{36}$/);
    await expect(leafRow(contents(page), pista.name)).toContainText("×1");
    await expect(contents(page).getByRole("button", { name: /Zona de bienvenida/ })).toBeVisible();
    await expect(facts(page)).toHaveText(["Casa", "30 m²", "22 m²", "8 m²"]);

    await contents(page).getByRole("button", { name: `Quitar una unidad de ${pista.name}` }).click();
    await expect(facts(page)).toHaveText(["Casa", "30 m²", "6 m²", "24 m²"]);

    await page.goto(packagePath);
    await expect(leafRow(contents(page), pista.name)).toContainText("×1");
    await expect(facts(page)).toHaveText(["Casa", "30 m²", "22 m²", "8 m²"]);
  });

  test("vista 3D en Android: GLB real, Scene Viewer y escala fija 1:1", async ({ page }) => {
    await page.goto(packagePath);

    await page.getByRole("link", { name: `Ver ${mesa.name} en 3D` }).click();
    await expect(page).toHaveURL(new RegExp(`${packagePath}/modules/${mesa.id}$`));
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(mesa.name);

    const model = page.getByTestId("model-viewer");
    await expect(model).toHaveAttribute("src", mesa.glbUrl);
    await expect(model).toHaveAttribute("ar", "");
    await expect(model).toHaveAttribute("ar-modes", "scene-viewer webxr");
    await expect(model).toHaveAttribute("ar-scale", "fixed");
    await expect(model).toHaveAttribute("ar-placement", "floor");
    await expect(model).toHaveAttribute("data-renderer", "scene-viewer");
    await expect(model).toHaveAttribute("data-asset-key", `mesa@v${mesa.version}`);
    await expect(model).not.toHaveAttribute("ios-src");

    // El GLB publicado en Cloudinary carga en el visor.
    await expect
      .poll(() => model.evaluate((element) => (element as HTMLElement & { loaded?: boolean }).loaded), {
        timeout: 45_000,
      })
      .toBe(true);
    // Lanzamiento AR presente sin abrir el visor nativo (evidencia manual).
    await expect(page.getByTestId("ar-launch")).toBeVisible();
    await expect(page.getByTestId("ar-steps")).toBeVisible();
    expect(await hasNoHorizontalOverflow(page)).toBe(true);
  });

  test("vista 3D en iPhone: USDZ obligatorio para AR Quick Look", async ({ browser }) => {
    const context = await browser.newContext({ storageState: STORAGE_A, userAgent: IPHONE_UA });
    const page = await context.newPage();

    await page.goto(`${packagePath}/modules/${mesa.id}`);

    const model = page.getByTestId("model-viewer");
    await expect(model).toHaveAttribute("data-renderer", "quick-look");
    await expect(model).toHaveAttribute("ios-src", mesa.usdzUrl);
    await expect(model).toHaveAttribute("ar-modes", "quick-look");
    await expect(model).toHaveAttribute("ar-scale", "fixed");
    await expect(model).toHaveAttribute("ar-placement", "floor");

    await context.close();
  });
});
