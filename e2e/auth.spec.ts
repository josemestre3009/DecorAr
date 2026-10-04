import { expect, test, type Locator, type Page } from "@playwright/test";

const email = process.env.DECOR_E2E_EMAIL;
const password = process.env.DECOR_E2E_PASSWORD;
const hasCredentials = Boolean(email && password);

// El registro envía un correo de confirmación, así que consume la cuota del
// servicio interno de correo. Se activa a propósito para no agotarla.
const allowSignup = process.env.DECOR_E2E_ALLOW_SIGNUP === "1";

const missingCredentials = "requiere DECOR_E2E_EMAIL y DECOR_E2E_PASSWORD";
const signupDisabled = "requiere DECOR_E2E_ALLOW_SIGNUP=1";

async function fillCredentials(page: Page, mail: string, secret: string) {
  await page.getByLabel("Correo electrónico").fill(mail);
  await page.getByLabel("Contraseña").fill(secret);
}

async function signIn(page: Page) {
  await page.goto("/login");
  await fillCredentials(page, email as string, password as string);
  await page.getByRole("button", { name: "Entrar" }).click();
}

test.describe("rutas protegidas", () => {
  test("el catálogo redirige al login sin sesión", async ({ page }) => {
    await page.goto("/packages");

    await expect(page).toHaveURL(/\/login$/);
  });

  test("las subrutas del catálogo también redirigen", async ({ page }) => {
    await page.goto("/packages/12");

    await expect(page).toHaveURL(/\/login$/);
  });

  test("el login sigue accesible sin sesión", async ({ page }) => {
    await page.goto("/login");

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Iniciar sesión");
  });
});

test.describe("validación sin llamar al proveedor", () => {
  test("marca el correo con formato inválido", async ({ page }) => {
    await page.goto("/login");
    await fillCredentials(page, "persona@", "secreto");

    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(page.getByText("El correo electrónico no tiene un formato válido.")).toBeVisible();
    await expect(page.getByLabel("Correo electrónico")).toHaveAttribute("aria-invalid", "true");
    // React 19 vacía los campos no controlados al terminar la acción: el correo
    // debe seguir ahí para que la persona lo corrija en lugar de reescribirlo.
    await expect(page.getByLabel("Correo electrónico")).toHaveValue("persona@");
    // Tras la respuesta el botón vuelve a estar usable: cubre la recuperación.
    await expect(page.getByRole("button", { name: "Entrar" })).toBeEnabled();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("marca la contraseña vacía", async ({ page }) => {
    await page.goto("/signup");
    await fillCredentials(page, "persona@example.com", "");

    await page.getByRole("button", { name: "Crear cuenta" }).click();

    await expect(page.getByText("Escribe tu contraseña.")).toBeVisible();
    await expect(page.getByLabel("Contraseña")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Correo electrónico")).toHaveValue("persona@example.com");
  });

  test("enlaza el login con el registro en ambos sentidos", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Regístrate" }).click();

    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Crear cuenta");

    await page.getByRole("link", { name: "Inicia sesión" }).click();

    await expect(page).toHaveURL(/\/login$/);
  });
});

async function focusStyles(locator: Locator) {
  return locator.evaluate((element) => {
    const styles = getComputedStyle(element);

    return {
      color: styles.outlineColor,
      style: styles.outlineStyle,
      width: Number.parseFloat(styles.outlineWidth),
    };
  });
}

test.describe("formulario accesible y responsive", () => {
  for (const ruta of ["/login", "/signup"]) {
    test(`no desborda horizontalmente a 360 px en ${ruta}`, async ({ page }) => {
      await page.setViewportSize({ height: 720, width: 360 });
      await page.goto(ruta);

      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    });
  }

  test("muestra un foco visible al recorrer el formulario con el teclado", async ({ page }) => {
    await page.goto("/login");

    // El foco se alcanza con Tab real: asignarlo a mano no activaría
    // :focus-visible, que es justo lo que hay que comprobar.
    const controles = [
      page.getByLabel("Correo electrónico"),
      page.getByLabel("Contraseña"),
      page.locator("form button[type=submit]"),
      page.getByRole("link", { name: "Regístrate" }),
    ];

    for (const control of controles) {
      await page.keyboard.press("Tab");
      await expect(control).toBeFocused();

      const outline = await focusStyles(control);
      expect(outline.style).toBe("solid");
      expect(outline.width).toBeGreaterThan(0);
      expect(outline.color).not.toBe("rgba(0, 0, 0, 0)");
    }
  });

  test("mantiene el botón deshabilitado y muestra el procesando durante la petición", async ({
  page,
}) => {
  await page.goto("/login");

  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  // Retrasa la Server Action para poder observar el estado de envío con una
  // petición real en vuelo, en lugar de simularla.
  await page.route("**/login", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }

    await held;
    await route.continue();
  });

  await fillCredentials(page, "persona@example.com", "secreto");

  const submit = page.locator("form button[type=submit]");
  await submit.click();

  await expect(submit).toBeDisabled();
  await expect(submit).toHaveText("Entrando…");

  release();

  await expect(submit).toHaveText("Entrar");
  await expect(submit).toBeEnabled();
});

test("asocia cada error a su campo con aria-describedby y lo anuncia", async ({ page }) => {
  await page.goto("/signup");
  await fillCredentials(page, "persona@example.com", "");
  await page.getByRole("button", { name: "Crear cuenta" }).click();

  await expect(page.getByText("Escribe tu contraseña.")).toBeVisible();
  await expect(page.getByLabel("Contraseña")).toHaveAttribute(
    "aria-describedby",
    "password-error",
  );
  // El foco sigue en el botón tras el envío, así que el mensaje necesita su
  // propia región viva para que un lector de pantalla lo anuncie.
  await expect(page.locator("#password-error")).toHaveAttribute("role", "alert");
});
});

test.describe("sesión real", () => {
  test("inicia sesión, conserva la sesión al recargar y cierra sesión", async ({ page }) => {
    test.skip(!hasCredentials, missingCredentials);

    await signIn(page);

    await expect(page).toHaveURL(/\/packages$/);
    await expect(page.getByText(`Sesión activa: ${email}`)).toBeVisible();

    await page.reload();

    await expect(page).toHaveURL(/\/packages$/);
    await expect(page.getByText(`Sesión activa: ${email}`)).toBeVisible();

    await page.getByRole("button", { name: "Cerrar sesión" }).click();

    await expect(page).toHaveURL(/\/login$/);

    await page.goto("/packages");

    await expect(page).toHaveURL(/\/login$/);
  });

  test("el registro pide confirmar el correo", async ({ page }) => {
    test.skip(!allowSignup, signupDisabled);

    const uniqueEmail = `e2e.${Date.now()}@example.com`;

    await page.goto("/signup");
    await fillCredentials(page, uniqueEmail, "SeCRETO-de-prueba-9");

    await page.getByRole("button", { name: "Crear cuenta" }).click();

    await expect(page.getByRole("status")).toContainText(uniqueEmail);
    await expect(page).toHaveURL(/\/signup$/);
  });
});

test.describe("API protegida", () => {
  test("responde 401 en JSON sin sesión", async ({ request }) => {
    const response = await request.get("/api/session");

    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "unauthorized" });
  });

  test("deja de responder 401 con sesión", async ({ page }) => {
    test.skip(!hasCredentials, missingCredentials);

    await signIn(page);
    await expect(page).toHaveURL(/\/packages$/);

    // `page.request` comparte el almacen de cookies con el navegador; el
    // fixture `request` tiene el suyo propio y enviaría la peticion sin sesion.
    const response = await page.request.get("/api/session");

    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toHaveProperty("userId");
  });
});
