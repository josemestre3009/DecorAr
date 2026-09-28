import { expect, test } from "@playwright/test";

test("la portada móvil identifica DecorAR", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/DecorAR/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Imagina el espacio",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
