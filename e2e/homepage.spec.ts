import { expect, test } from "@playwright/test";

test("la portada móvil identifica DecorAR", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/DecorAR/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Tu evento, tu realidad aumentada");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
});
