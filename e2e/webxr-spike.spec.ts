import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

const email = process.env.DECOR_E2E_EMAIL;
const password = process.env.DECOR_E2E_PASSWORD;
const hasCredentials = Boolean(email && password);
const missingCredentials = "requiere DECOR_E2E_EMAIL y DECOR_E2E_PASSWORD";
const catalogFixture = readFileSync(resolve("public/fixtures/catalog-modules.json"), "utf8");
const [mesa] = JSON.parse(catalogFixture) as { id: string }[];

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Correo electrónico").fill(email as string);
  await page.getByLabel("Contraseña").fill(password as string);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/packages$/);
}

test("el spike exige sesión", async ({ page }) => {
  await page.goto(`/packages/p-e2e/modules/${mesa.id}/spike`);
  await expect(page).toHaveURL(/\/login$/);
});

test.describe("spike WebXR multiobjeto", () => {
  test.skip(!hasCredentials, missingCredentials);

  test("degrada sin WebXR, cabe a 360 px y conserva foco visible", async ({ page }) => {
    await page.setViewportSize({ height: 720, width: 360 });
    await page.route("**/api/modules", (route) =>
      route.fulfill({ body: catalogFixture, contentType: "application/json", status: 200 }),
    );
    await signIn(page);
    await page.goto(`/packages/p-e2e/modules/${mesa.id}/spike`);

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Spike WebXR multiobjeto");
    await expect(page.getByRole("alert")).toContainText("no permite ejecutar");
    await expect(page.getByRole("button", { name: "Iniciar prueba AR" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.keyboard.press("Tab");
    const focused = page.locator(":focus-visible");
    await expect(focused).toBeVisible();
    expect(await focused.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
  });
});
