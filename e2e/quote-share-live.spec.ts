/**
 * DECOR-54: compartir la cotización por WhatsApp, contra la API real.
 *
 * Opt-in, como los demás smoke live: solo corre con DECOR_LIVE_SMOKE=1 y las
 * variables de Supabase, porque crea un usuario real. Requiere la migración de
 * cotizaciones (DECOR-50); el escenario del enlace real además requiere la de
 * enlaces públicos (DECOR-53) y DECOR_PUBLIC_APP_URL / DECOR_SHARE_LINK_SECRET
 * configuradas en el servidor. El usuario se crea con la admin API y se elimina
 * al final junto con su evento (cascada a cotizaciones y enlaces).
 *
 * Web Share API y portapapeles se simulan con `addInitScript`: el navegador de
 * pruebas no tiene menú nativo de compartir. WhatsApp no se abre: se comprueba
 * el enlace wa.me. La API del enlace se simula con `page.route` en los dos
 * primeros escenarios; el tercero usa el enlace real y se omite, con el
 * motivo, si la API de DECOR-53 no está disponible.
 *
 *   DECOR_LIVE_SMOKE=1 node --env-file=.env.local node_modules/@playwright/test/cli.js test e2e/quote-share-live.spec.ts
 *
 * Con un `npm run dev` ya levantado, añade DECOR_E2E_BASE_URL=http://localhost:3000.
 */
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import { devices, expect, test, type Page } from "@playwright/test";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const enabled = process.env.DECOR_LIVE_SMOKE === "1" && Boolean(url && serviceRoleKey);
const disabledReason = "requiere DECOR_LIVE_SMOKE=1, NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY";

const noSession = { auth: { autoRefreshToken: false, persistSession: false } };
const CLIENT_NAME = "Ana Pérez";
const DAY_MS = 24 * 60 * 60 * 1000;
const MOCK_URL = "https://decorar.example/c/token-simulado-e2e";

type CatalogModule = { id: string; name: string };
type ShareProbe = { shared: ShareData[]; copied: string[] };

declare global {
  interface Window {
    __decorShare: ShareProbe;
  }
}

function mockLink(quoteId: string) {
  return {
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
    id: "link-simulado-e2e",
    quoteId,
    revokedAt: null,
    url: MOCK_URL,
  };
}

/** Simula Web Share API y portapapeles y registra lo que se les entrega. */
async function stubShareApis(page: Page, { webShare }: { webShare: boolean }) {
  await page.addInitScript((withWebShare: boolean) => {
    window.__decorShare = { copied: [], shared: [] };
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: withWebShare
        ? async (data: ShareData) => {
            window.__decorShare.shared.push(data);
          }
        : undefined,
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          window.__decorShare.copied.push(text);
        },
      },
    });
  }, webShare);
}

/**
 * Simula la API del enlace (DECOR-53) en el navegador para que la prueba de
 * DECOR-54 no dependa de su migración. GET responde con el enlace simulado o
 * sin enlace; POST crea el enlace simulado.
 */
async function mockShareLinkApi(page: Page, quoteId: string, existing: boolean) {
  await page.route(`**/api/quotes/${quoteId}/share-link`, async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({ json: { link: existing ? mockLink(quoteId) : null } });
      return;
    }
    if (method === "POST") {
      await route.fulfill({ json: mockLink(quoteId), status: 201 });
      return;
    }
    await route.fallback();
  });
}

function probe(page: Page): Promise<ShareProbe> {
  return page.evaluate(() => window.__decorShare);
}

async function whatsAppText(page: Page): Promise<string> {
  const href = (await page.getByRole("link", { name: "Enviar por WhatsApp" }).getAttribute("href")) ?? "";
  expect(href.startsWith("https://wa.me/?text=")).toBe(true);
  return new URL(href).searchParams.get("text") ?? "";
}

test.describe.serial("DECOR-54 compartir cotización por WhatsApp (smoke live)", () => {
  test.skip(!enabled, disabledReason);

  const admin = enabled ? createClient(url, serviceRoleKey, noSession) : (null as never);
  const email = `decor54-smoke-${randomUUID()}@decorar.test`;
  const password = `${randomUUID()}Aa1!`;
  let userId: string | null = null;
  let packageId: string | null = null;
  let quoteId: string | null = null;

  test.beforeAll(async () => {
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    userId = created.data.user.id;
  });

  test.afterAll(async () => {
    if (packageId) await admin.from("packages").delete().eq("id", packageId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  async function signIn(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Correo electrónico").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page).toHaveURL(/\/packages$/);
  }

  /** Evento con un concepto, cotización y paso a «enviada», todo por la API real. */
  async function prepareSentQuote(page: Page): Promise<string> {
    const createdPackage = await page.request.post("/api/packages", {
      data: { capacityM2: 50, name: "Evento DECOR-54", spaceType: "salonSocial" },
    });
    expect(createdPackage.status(), await createdPackage.text()).toBe(201);
    packageId = ((await createdPackage.json()) as { id: string }).id;

    const catalog = (await (await page.request.get("/api/modules")).json()) as CatalogModule[];
    expect(catalog.length, "el catálogo live debe tener módulos activos").toBeGreaterThan(0);
    const added = await page.request.post(`/api/packages/${packageId}/items`, { data: { moduleId: catalog[0].id } });
    expect(added.status(), await added.text()).toBe(201);

    const validUntil = new Date(Date.now() + 30 * DAY_MS).toISOString().slice(0, 10);
    const createdQuote = await page.request.post(`/api/packages/${packageId}/quotes`, {
      data: {
        clientName: CLIENT_NAME,
        conditions: null,
        depositRateBp: 5_000,
        discountRateBp: 0,
        taxRateBp: 1_900,
        validUntil,
      },
    });
    expect(createdQuote.status(), await createdQuote.text()).toBe(201);
    const id = ((await createdQuote.json()) as { id: string }).id;

    const sent = await page.request.patch(`/api/quotes/${id}/status`, { data: { status: "sent" } });
    expect(sent.status(), await sent.text()).toBe(200);

    return id;
  }

  test("con Web Share: comparte solo texto con el enlace público, sin archivos", async ({ page }) => {
    await stubShareApis(page, { webShare: true });
    await signIn(page);
    quoteId = await prepareSentQuote(page);
    await mockShareLinkApi(page, quoteId, false);

    await page.goto(`/quotes/${quoteId}`);
    await expect(page.getByRole("link", { name: "Enviar por WhatsApp" })).toHaveCount(0);
    await page.getByRole("button", { name: "Crear enlace" }).click();
    await expect(page.getByLabel("Enlace público")).toHaveValue(MOCK_URL);

    // Compartir (menú nativo simulado).
    await page.getByRole("button", { name: "Compartir" }).click();
    await expect.poll(async () => (await probe(page)).shared.length).toBe(1);
    const [shared] = (await probe(page)).shared;
    expect(Object.keys(shared)).toEqual(["text"]);
    const text = shared.text ?? "";
    expect(text).toContain(CLIENT_NAME);
    expect(text).toMatch(/Cotización N\.º \d+ · versión 1/);
    expect(text).toContain("Total: ");
    expect(text).toContain("Válida hasta: ");
    expect(text.split(MOCK_URL)).toHaveLength(2);
    // Dentro de la sección: Next.js tiene su propio anunciador de rutas con role="alert".
    await expect(page.getByRole("region", { name: "Enlace para el cliente" }).getByRole("alert")).toHaveCount(0);

    // WhatsApp (wa.me) lleva el mismo mensaje, en otra pestaña.
    expect(await whatsAppText(page)).toBe(text);
    await expect(page.getByRole("link", { name: "Enviar por WhatsApp" })).toHaveAttribute("target", "_blank");

    // Copiar enlace como respaldo.
    await page.getByRole("button", { name: "Copiar enlace" }).click();
    await expect(page.getByRole("button", { name: "Copiado" })).toBeVisible();
    expect((await probe(page)).copied).toEqual([MOCK_URL]);
  });

  test("sin Web Share: quedan WhatsApp y copiar enlace", async ({ page }) => {
    test.skip(!quoteId, "depende del escenario anterior");
    await stubShareApis(page, { webShare: false });
    await signIn(page);
    await mockShareLinkApi(page, quoteId!, true);

    await page.goto(`/quotes/${quoteId}`);
    await expect(page.getByLabel("Enlace público")).toHaveValue(MOCK_URL);
    await expect(page.getByRole("button", { name: "Compartir" })).toHaveCount(0);
    expect(await whatsAppText(page)).toContain(MOCK_URL);

    await page.getByRole("button", { name: "Copiar enlace" }).click();
    await expect(page.getByRole("button", { name: "Copiado" })).toBeVisible();
    expect((await probe(page)).copied).toEqual([MOCK_URL]);
  });

  test("con el enlace real, el mensaje lo incluye y abre la cotización sin sesión", async ({ browser, page }) => {
    test.skip(!quoteId, "depende del primer escenario");
    await stubShareApis(page, { webShare: false });
    await signIn(page);

    const created = await page.request.post(`/api/quotes/${quoteId}/share-link`);
    test.skip(
      created.status() !== 201,
      `la API real del enlace (DECOR-53) respondió ${created.status()}: falta aplicar su migración o configurar DECOR_PUBLIC_APP_URL / DECOR_SHARE_LINK_SECRET`,
    );
    const realUrl = ((await created.json()) as { url: string }).url;

    await page.goto(`/quotes/${quoteId}`);
    await expect(page.getByLabel("Enlace público")).toHaveValue(realUrl);
    expect(await whatsAppText(page)).toContain(realUrl);

    // Mismo camino /c/{token} contra el servidor de la prueba: el origen de
    // DECOR_PUBLIC_APP_URL puede ser otro (p. ej. el dominio desplegado).
    const anonymous = await browser.newContext({ ...devices["Pixel 7"], baseURL: test.info().project.use.baseURL });
    try {
      const publicPage = await anonymous.newPage();
      const response = await publicPage.goto(new URL(realUrl).pathname);

      expect(response?.status()).toBe(200);
      await expect(publicPage.getByText(CLIENT_NAME).first()).toBeVisible();
    } finally {
      await anonymous.close();
    }
  });
});
