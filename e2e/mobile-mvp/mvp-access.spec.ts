/**
 * DECOR-39: acceso. Una sesión anónima no entra a páginas ni a la API, y el
 * usuario B no puede ver un paquete de A (404, sin revelar que existe).
 */
import { expect, test } from "@playwright/test";

import { STORAGE_A, STORAGE_B } from "./helpers";

let packageOfA = "";

test.beforeAll(async ({ playwright, baseURL }) => {
  const asA = await playwright.request.newContext({ baseURL, storageState: STORAGE_A });
  const created = await asA.post("/api/packages", { data: { capacityM2: 30, spaceType: "casa" } });
  expect(created.status()).toBe(201);
  packageOfA = ((await created.json()) as { id: string }).id;
  await asA.dispose();
});

test.describe("sesión anónima bloqueada", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("las páginas protegidas redirigen a /login", async ({ page }) => {
    for (const path of ["/packages", `/packages/${packageOfA}`, `/packages/${packageOfA}/modules/x`]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    }
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Iniciar sesión");
  });

  test("la API de paquetes responde 401 sin sesión", async ({ playwright, baseURL }) => {
    const anonymous = await playwright.request.newContext({ baseURL });

    const create = await anonymous.post("/api/packages", { data: { capacityM2: 30, spaceType: "casa" } });
    expect(create.status()).toBe(401);
    expect(((await create.json()) as { error: { code: string } }).error.code).toBe("auth.unauthenticated");

    const budget = await anonymous.get(`/api/packages/${packageOfA}/budget`);
    expect(budget.status()).toBe(401);

    await anonymous.dispose();
  });
});

test.describe("usuario B", () => {
  test.use({ storageState: STORAGE_B });

  test("no ve el paquete de A ni su presupuesto", async ({ page }) => {
    const pageResponse = await page.goto(`/packages/${packageOfA}`);
    expect(pageResponse?.status()).toBe(404);

    const budget = await page.request.get(`/api/packages/${packageOfA}/budget`);
    expect(budget.status()).toBe(404);
  });
});
