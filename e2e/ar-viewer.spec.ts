import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const email = process.env.DECOR_E2E_EMAIL;
const password = process.env.DECOR_E2E_PASSWORD;
const hasCredentials = Boolean(email && password);
const missingCredentials = "requiere DECOR_E2E_EMAIL y DECOR_E2E_PASSWORD";

// Fixture de DECOR-28 (misma forma que GET /api/modules). Sus URLs apuntan a
// example.com: los modelos se sirven con un GLB real del repositorio y el resto
// se aborta, así la prueba no depende de la red ni de Cloudinary.
const catalogFixture = readFileSync(resolve("public/fixtures/catalog-modules.json"), "utf8");
const catalog = JSON.parse(catalogFixture) as { id: string; name: string; glbUrl: string; usdzUrl: string }[];
const [mesa, arco, pista] = catalog as [
  (typeof catalog)[number],
  (typeof catalog)[number],
  (typeof catalog)[number],
];
const sampleGlb = readFileSync(resolve("assets/3d/pista/v2/animated_dance_floor_neon_lights.glb"));

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email as string);
  await page.getByLabel("Contraseña").fill(password as string);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/packages$/);
}

async function serveCatalogAndModels(page: Page) {
  await page.route("**/api/modules", (route) =>
    route.fulfill({ body: catalogFixture, contentType: "application/json", status: 200 }),
  );
  await page.route("https://example.com/**", (route) =>
    route.request().url().endsWith(".glb")
      ? route.fulfill({
          body: sampleGlb,
          contentType: "model/gltf-binary",
          headers: { "Access-Control-Allow-Origin": "*" },
          status: 200,
        })
      : route.abort(),
  );
}

async function hasNoHorizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

const viewer = (page: Page) => page.getByTestId("model-viewer");

test.describe("vista 3D sin sesión", () => {
  test("la vista 3D de un módulo exige sesión", async ({ page }) => {
    await page.goto(`/packages/paquete-de-prueba/modules/${mesa.id}`);

    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("vista 3D y AR (DECOR-23)", () => {
  test.skip(!hasCredentials, missingCredentials);

  test("desde el catálogo abre la mesa en 3D, lista para Scene Viewer a escala fija", async ({
    page,
  }) => {
    await page.setViewportSize({ height: 720, width: 360 });
    await serveCatalogAndModels(page);
    await signIn(page);
    await page.goto("/packages/paquete-e2e");

    await page.getByRole("link", { name: "Ver Mesa redonda en 3D" }).click();

    await expect(page).toHaveURL(new RegExp(`/packages/paquete-e2e/modules/${mesa.id}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ver en 3D");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText("Mesa redonda");

    const model = viewer(page);
    await expect(model).toHaveAttribute("src", mesa.glbUrl);
    await expect(model).toHaveAttribute("ar", "");
    await expect(model).toHaveAttribute("ar-modes", "scene-viewer webxr");
    await expect(model).toHaveAttribute("ar-scale", "fixed");
    await expect(model).toHaveAttribute("ar-placement", "floor");
    await expect(model).toHaveAttribute("camera-controls", "");
    await expect(model).toHaveAttribute("data-renderer", "scene-viewer");
    await expect(model).toHaveAttribute("data-asset-key", "mesa@v1");
    await expect(model).not.toHaveAttribute("ios-src");
    await expect(page.getByTestId("ar-launch")).toBeAttached();

    // El custom element se registró solo en el navegador y cargó el GLB.
    expect(await page.evaluate(() => Boolean(customElements.get("model-viewer")))).toBe(true);
    await expect
      .poll(() => model.evaluate((element) => (element as HTMLElement & { loaded?: boolean }).loaded))
      .toBe(true);
    await expect(page.getByLabel("Cargando modelo 3D")).toHaveCount(0);
    // Chrome en Android ofrece AR: botón visible, pasos y sin aviso.
    await expect(page.getByTestId("ar-launch")).toBeVisible();
    await expect(page.getByTestId("ar-steps")).toBeVisible();
    await expect(page.getByTestId("ar-unsupported")).toHaveCount(0);

    expect(await hasNoHorizontalOverflow(page)).toBe(true);
  });

  test("arco y pista también tienen su vista AR", async ({ page }) => {
    await serveCatalogAndModels(page);
    await signIn(page);

    for (const modulo of [arco, pista]) {
      await page.goto(`/packages/paquete-e2e/modules/${modulo.id}`);

      await expect(page.getByRole("heading", { level: 2 })).toHaveText(modulo.name);
      await expect(viewer(page)).toHaveAttribute("src", modulo.glbUrl);
      await expect(viewer(page)).toHaveAttribute("ar-scale", "fixed");
    }
  });

  test("el enlace de volver regresa al catálogo del paquete", async ({ page }) => {
    await serveCatalogAndModels(page);
    await signIn(page);
    await page.goto(`/packages/paquete-e2e/modules/${mesa.id}`);

    await page.getByRole("link", { name: "← Volver al catálogo" }).click();

    await expect(page).toHaveURL(/\/packages\/paquete-e2e$/);
  });

  test("un módulo que ya no está en el catálogo se informa sin visor", async ({ page }) => {
    await serveCatalogAndModels(page);
    await signIn(page);
    await page.goto("/packages/paquete-e2e/modules/no-existe");

    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "Este módulo ya no está disponible en el catálogo.",
    );
    await expect(viewer(page)).toHaveCount(0);
  });
});

test.describe("vista 3D en iPhone (DECOR-23)", () => {
  test.skip(!hasCredentials, missingCredentials);
  test.use({ userAgent: IPHONE_UA });

  test("en iOS entrega el USDZ obligatorio para AR Quick Look", async ({ page }) => {
    await serveCatalogAndModels(page);
    await signIn(page);
    await page.goto(`/packages/paquete-e2e/modules/${mesa.id}`);

    const model = viewer(page);
    await expect(model).toHaveAttribute("data-renderer", "quick-look");
    await expect(model).toHaveAttribute("ios-src", mesa.usdzUrl);
    await expect(model).toHaveAttribute("ar-modes", "quick-look");
    await expect(model).toHaveAttribute("ar-scale", "fixed");
  });

  test("si el navegador del iPhone no tiene Quick Look, pide abrir Safari y no muestra pasos", async ({
    page,
  }) => {
    // Chromium no implementa Quick Look, igual que el navegador interno de
    // WhatsApp o Instagram: model-viewer responde que no puede abrir AR.
    await serveCatalogAndModels(page);
    await signIn(page);
    await page.goto(`/packages/paquete-e2e/modules/${mesa.id}`);

    await expect(page.getByTestId("ar-unsupported")).toContainText("abre esta página en Safari");
    await expect(page.getByTestId("ar-steps")).toHaveCount(0);
    await expect(page.getByTestId("ar-launch")).toBeHidden();
  });
});
